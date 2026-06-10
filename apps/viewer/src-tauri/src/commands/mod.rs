use serde::{Deserialize, Serialize};
use std::fs;
use std::io::BufWriter;
use pulldown_cmark::{Parser, Event, Tag, TagEnd, HeadingLevel};

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchHit { pub page_index: usize, pub element_index: usize, pub text: String, pub context: String }

#[derive(Debug, Serialize, Deserialize)]
pub struct ValidationResult { pub valid: bool, pub errors: Vec<String> }

#[tauri::command]
pub fn open_document(path: String) -> Result<serde_json::Value, String> {
    let content = fs::read_to_string(&path).map_err(|e| format!("Failed to read: {}", e))?;
    let doc: serde_json::Value = serde_json::from_str(&content).map_err(|e| format!("Invalid JSON: {}", e))?;
    if doc.get("$jdf").is_none() { return Err("Not a JDF document".to_string()); }
    Ok(doc)
}

#[tauri::command]
pub fn save_document(path: String, document: serde_json::Value) -> Result<(), String> {
    let content = serde_json::to_string_pretty(&document).map_err(|e| format!("{}", e))?;
    fs::write(&path, content).map_err(|e| format!("{}", e))?;
    Ok(())
}

#[tauri::command]
pub fn validate_document(document: serde_json::Value) -> Result<ValidationResult, String> {
    let mut errors = Vec::new();
    if document.get("$jdf").is_none() { errors.push("Missing $jdf".into()); }
    if document.get("meta").is_none() { errors.push("Missing meta".into()); }
    if document.get("pages").and_then(|p| p.as_array()).map(|a| a.is_empty()).unwrap_or(true) { errors.push("No pages".into()); }
    Ok(ValidationResult { valid: errors.is_empty(), errors })
}

#[tauri::command]
pub fn search_document(document: serde_json::Value, query: String) -> Result<Vec<SearchHit>, String> {
    let mut hits = Vec::new();
    let q = query.to_lowercase();
    if let Some(pages) = document.get("pages").and_then(|p| p.as_array()) {
        for (pi, page) in pages.iter().enumerate() {
            if let Some(elements) = page.get("elements").and_then(|e| e.as_array()) {
                for (ei, el) in elements.iter().enumerate() {
                    let text = extract_text(el);
                    if let Some(pos) = text.to_lowercase().find(&q) {
                        let s = pos.saturating_sub(20);
                        let e = (pos + query.len() + 20).min(text.len());
                        hits.push(SearchHit { page_index: pi, element_index: ei, text: query.clone(), context: text[s..e].to_string() });
                    }
                }
            }
        }
    }
    Ok(hits)
}

#[tauri::command]
pub async fn import_pdf(path: String) -> Result<serde_json::Value, String> {
    let bytes = fs::read(&path).map_err(|e| format!("Failed to read: {}", e))?;
    let text = tokio::task::spawn_blocking(move || {
        let _g = suppress_stderr();
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| pdf_extract::extract_text_from_mem(&bytes)))
    }).await.map_err(|e| format!("{}", e))?.map_err(|_| "PDF parse crashed".to_string())?.map_err(|e| format!("{}", e))?;

    let title = std::path::Path::new(&path).file_stem().and_then(|s| s.to_str()).unwrap_or("Imported").to_string();
    Ok(text_to_jdf(&text, &title))
}

#[tauri::command]
pub fn import_markdown(path: String) -> Result<serde_json::Value, String> {
    let content = fs::read_to_string(&path).map_err(|e| format!("{}", e))?;
    let title = std::path::Path::new(&path).file_stem().and_then(|s| s.to_str()).unwrap_or("Document").to_string();
    Ok(markdown_to_jdf(&content, &title))
}

#[tauri::command]
pub async fn export_pdf(document: serde_json::Value, path: String) -> Result<(), String> {
    use printpdf::*;
    let title = document.get("meta").and_then(|m| m.get("title")).and_then(|t| t.as_str()).unwrap_or("Document");
    let pages = document.get("pages").and_then(|p| p.as_array()).ok_or("No pages")?;
    let (doc, first_page, first_layer) = PdfDocument::new(title, Mm(210.0), Mm(297.0), "Layer 1");
    let font = doc.add_builtin_font(BuiltinFont::Helvetica).map_err(|e| format!("{}", e))?;
    let font_bold = doc.add_builtin_font(BuiltinFont::HelveticaBold).map_err(|e| format!("{}", e))?;

    for (i, page) in pages.iter().enumerate() {
        let (cp, cl) = if i == 0 { (first_page.clone(), first_layer.clone()) } else { doc.add_page(Mm(210.0), Mm(297.0), "Layer 1") };
        let layer = doc.get_page(cp).get_layer(cl);
        if let Some(elements) = page.get("elements").and_then(|e| e.as_array()) {
            for el in elements {
                let tp = el.get("type").and_then(|t| t.as_str()).unwrap_or("");
                if tp == "text" || tp == "richtext" {
                    let content = if tp == "text" { el.get("content").and_then(|c| c.as_str()).unwrap_or("").to_string() }
                    else { el.get("runs").and_then(|r| r.as_array()).map(|runs| runs.iter().filter_map(|r| r.get("text").and_then(|t| t.as_str())).collect::<Vec<_>>().join("")).unwrap_or_default() };
                    if content.is_empty() { continue; }
                    let px = el.get("position").and_then(|p| p.get("x")).and_then(|x| x.as_f64()).unwrap_or(0.0) as f32;
                    let py = el.get("position").and_then(|p| p.get("y")).and_then(|y| y.as_f64()).unwrap_or(0.0) as f32;
                    let fs = get_font_size(el, &document) as f32;
                    let bold = is_bold(el, &document);
                    let f = if bold { &font_bold } else { &font };
                    for (li, line) in content.split('\n').enumerate() {
                        if line.trim().is_empty() { continue; }
                        layer.use_text(line.to_string(), fs, Mm(22.0 + px), Mm(297.0 - 25.0 - py - li as f32 * fs * 0.4), f);
                    }
                }
            }
        }
    }
    let file = fs::File::create(&path).map_err(|e| format!("{}", e))?;
    doc.save(&mut BufWriter::new(file)).map_err(|e| format!("{}", e))?;
    Ok(())
}

// --- Helpers ---

fn text_to_jdf(text: &str, title: &str) -> serde_json::Value {
    let max_y = 247.0f64;
    let w = 166.0f64;
    let mut pages: Vec<serde_json::Value> = Vec::new();
    let mut els: Vec<serde_json::Value> = Vec::new();
    let mut y = 5.0f64;
    let mut pn = 1usize;
    let mut first = true;

    for block in text.split("\n\n").map(|b| b.trim()).filter(|b| !b.is_empty()) {
        let is_bullet = block.lines().any(|l| l.trim().starts_with('●') || l.trim().starts_with('•') || l.trim().starts_with('-'));
        let is_heading = !is_bullet && block.len() < 80 && !block.contains('.') &&
            (first || block.chars().filter(|c| c.is_uppercase()).count() as f64 / block.len().max(1) as f64 > 0.4);
        let h = if is_heading { 10.0 } else if is_bullet { block.lines().count() as f64 * 5.0 + 3.0 } else { (block.len() as f64 / 80.0).ceil() * 4.5 + 3.0 };

        if y + h > max_y && !els.is_empty() {
            pages.push(serde_json::json!({"id": format!("page-{}", pn), "elements": els}));
            els = Vec::new(); y = 5.0; pn += 1;
        }

        if is_bullet {
            let items: Vec<serde_json::Value> = block.lines().map(|l| l.trim().trim_start_matches(|c:char| "●•-○* ".contains(c)).trim())
                .filter(|l| !l.is_empty()).map(|l| serde_json::json!({"content": l})).collect();
            els.push(serde_json::json!({"type":"list","listType":"unordered","position":{"x":0,"y":y},"width":w,"style":{"fontFamily":"Inter","fontSize":10,"lineHeight":1.6,"color":"#334155"},"items":items}));
        } else if is_heading {
            let sz = if first { 22 } else { 13 };
            els.push(serde_json::json!({"type":"text","content":block.replace('\n'," "),"position":{"x":0,"y":y},"width":w,"heading":true,"tocEntry":block.replace('\n'," "),"style":{"fontFamily":"Inter","fontSize":sz,"fontWeight":"bold","color": if first {"#0f172a"} else {"#2563eb"}}}));
        } else {
            els.push(serde_json::json!({"type":"text","content":block.replace('\n'," "),"position":{"x":0,"y":y},"width":w,"style":{"fontFamily":"Inter","fontSize":10,"lineHeight":1.6,"color":"#334155"}}));
        }
        y += h; first = false;
    }
    if !els.is_empty() { pages.push(serde_json::json!({"id": format!("page-{}", pn), "elements": els})); }
    if pages.is_empty() { pages.push(serde_json::json!({"id":"page-1","elements":[{"type":"text","content":"(Empty)","position":{"x":0,"y":20},"width":166,"style":{"fontSize":11,"color":"#94a3b8"}}]})); }
    serde_json::json!({"$jdf":"1.0.0","meta":{"title":title,"pageSize":"A4","unit":"mm","margins":{"top":25,"right":22,"bottom":25,"left":22}},"pages":pages})
}

fn markdown_to_jdf(md: &str, title: &str) -> serde_json::Value {
    let max_y = 247.0f64;
    let w = 166.0f64;
    let mut pages: Vec<serde_json::Value> = Vec::new();
    let mut els: Vec<serde_json::Value> = Vec::new();
    let mut y = 5.0f64;
    let mut pn = 1usize;
    let mut txt = String::new();
    let mut in_heading = false;
    let mut hlevel: u8 = 1;
    let mut in_list = false;
    let mut items: Vec<serde_json::Value> = Vec::new();
    let mut ordered = false;
    let mut in_code = false;
    let mut code = String::new();

    let parser = Parser::new(md);
    for event in parser {
        match event {
            Event::Start(Tag::Heading { level, .. }) => { flush_txt(&mut txt, &mut els, &mut y, w); in_heading = true; hlevel = match level { HeadingLevel::H1=>1, HeadingLevel::H2=>2, HeadingLevel::H3=>3, _=>4 }; }
            Event::End(TagEnd::Heading(_)) => {
                let sz = match hlevel { 1=>22.0, 2=>16.0, 3=>13.0, _=>11.0 };
                let h = sz * 0.6;
                if y + h > max_y && !els.is_empty() { pages.push(serde_json::json!({"id":format!("page-{}",pn),"elements":els})); els=Vec::new(); y=5.0; pn+=1; }
                if y > 10.0 && hlevel <= 2 { els.push(serde_json::json!({"type":"shape","shape":"rect","position":{"x":0,"y":y},"width":w,"height":0.3,"fill":"#e2e8f0"})); y+=4.0; }
                els.push(serde_json::json!({"type":"text","content":txt.trim(),"position":{"x":0,"y":y},"width":w,"heading":true,"tocEntry":txt.trim(),"style":{"fontFamily":"Inter","fontSize":sz,"fontWeight":"bold","color":if hlevel<=2{"#0f172a"}else{"#1e293b"}}}));
                y += h + 4.0; txt.clear(); in_heading = false;
            }
            Event::Start(Tag::List(o)) => { flush_txt(&mut txt, &mut els, &mut y, w); in_list=true; ordered=o.is_some(); items.clear(); }
            Event::End(TagEnd::List(_)) => {
                if !items.is_empty() { let h = items.len() as f64 * 5.0 + 3.0;
                    if y+h>max_y&&!els.is_empty() { pages.push(serde_json::json!({"id":format!("page-{}",pn),"elements":els})); els=Vec::new(); y=5.0; pn+=1; }
                    els.push(serde_json::json!({"type":"list","listType":if ordered{"ordered"}else{"unordered"},"position":{"x":0,"y":y},"width":w,"style":{"fontFamily":"Inter","fontSize":10,"lineHeight":1.6,"color":"#334155"},"items":items.clone()}));
                    y += h; } in_list=false; items.clear();
            }
            Event::Start(Tag::Item) => { txt.clear(); }
            Event::End(TagEnd::Item) => { items.push(serde_json::json!({"content":txt.trim()})); txt.clear(); }
            Event::Start(Tag::CodeBlock(_)) => { flush_txt(&mut txt, &mut els, &mut y, w); in_code=true; code.clear(); }
            Event::End(TagEnd::CodeBlock) => {
                let h = code.lines().count().max(1) as f64 * 4.0 + 8.0;
                if y+h>max_y&&!els.is_empty() { pages.push(serde_json::json!({"id":format!("page-{}",pn),"elements":els})); els=Vec::new(); y=5.0; pn+=1; }
                els.push(serde_json::json!({"type":"text","content":code.trim_end(),"position":{"x":0,"y":y},"width":w,"style":{"fontFamily":"JetBrains Mono","fontSize":9,"color":"#1e293b","backgroundColor":"#f1f5f9","padding":8,"borderRadius":4,"lineHeight":1.5}}));
                y += h; in_code = false;
            }
            Event::End(TagEnd::Paragraph) => { if !in_list { flush_txt(&mut txt, &mut els, &mut y, w); if y>max_y&&!els.is_empty() { pages.push(serde_json::json!({"id":format!("page-{}",pn),"elements":els})); els=Vec::new(); y=5.0; pn+=1; } } }
            Event::Text(t) => { if in_code { code.push_str(&t); } else { txt.push_str(&t); } }
            Event::Code(c) => { txt.push('`'); txt.push_str(&c); txt.push('`'); }
            Event::SoftBreak | Event::HardBreak => { txt.push(' '); }
            _ => {}
        }
    }
    flush_txt(&mut txt, &mut els, &mut y, w);
    if !els.is_empty() { pages.push(serde_json::json!({"id":format!("page-{}",pn),"elements":els})); }
    if pages.is_empty() { pages.push(serde_json::json!({"id":"page-1","elements":[{"type":"text","content":"(Empty)","position":{"x":0,"y":20},"width":166,"style":{"fontSize":11,"color":"#94a3b8"}}]})); }
    serde_json::json!({"$jdf":"1.0.0","meta":{"title":title,"pageSize":"A4","unit":"mm","margins":{"top":25,"right":22,"bottom":25,"left":22}},"pages":pages})
}

fn flush_txt(txt: &mut String, els: &mut Vec<serde_json::Value>, y: &mut f64, w: f64) {
    let t = txt.trim().to_string();
    if t.is_empty() { txt.clear(); return; }
    let h = (t.len() as f64 / 80.0).ceil().max(1.0) * 4.5 + 3.0;
    els.push(serde_json::json!({"type":"text","content":t,"position":{"x":0,"y":*y},"width":w,"style":{"fontFamily":"Inter","fontSize":10,"lineHeight":1.6,"color":"#334155"}}));
    *y += h; txt.clear();
}

fn extract_text(el: &serde_json::Value) -> String {
    el.get("content").and_then(|c| c.as_str()).map(|s| s.to_string())
        .or_else(|| el.get("runs").and_then(|r| r.as_array()).map(|runs| runs.iter().filter_map(|r| r.get("text").and_then(|t| t.as_str())).collect::<Vec<_>>().join("")))
        .or_else(|| el.get("title").and_then(|t| t.as_str()).map(|s| s.to_string()))
        .unwrap_or_default()
}

fn get_font_size(el: &serde_json::Value, doc: &serde_json::Value) -> f64 {
    if let Some(s) = el.get("style") {
        if let Some(sz) = s.get("fontSize").and_then(|v| v.as_f64()) { return sz; }
        if let Some(name) = s.as_str() { if let Some(sz) = doc.get("styles").and_then(|ss| ss.get(name)).and_then(|s| s.get("fontSize")).and_then(|v| v.as_f64()) { return sz; } }
    }
    10.5
}

fn is_bold(el: &serde_json::Value, doc: &serde_json::Value) -> bool {
    if let Some(s) = el.get("style") {
        if let Some(w) = s.get("fontWeight").and_then(|v| v.as_str()) { return w == "bold" || w == "600" || w == "700"; }
        if let Some(name) = s.as_str() { if let Some(w) = doc.get("styles").and_then(|ss| ss.get(name)).and_then(|s| s.get("fontWeight")).and_then(|v| v.as_str()) { return w == "bold" || w == "600" || w == "700"; } }
    }
    el.get("heading").and_then(|h| h.as_bool()).unwrap_or(false)
}

struct StderrGuard { old: Option<i32> }
fn suppress_stderr() -> StderrGuard {
    #[cfg(unix)] unsafe {
        let null = libc::open(b"/dev/null\0".as_ptr() as *const _, libc::O_WRONLY);
        if null >= 0 { let old = libc::dup(2); libc::dup2(null, 2); libc::close(null); return StderrGuard { old: Some(old) }; }
    }
    StderrGuard { old: None }
}
impl Drop for StderrGuard {
    fn drop(&mut self) { #[cfg(unix)] if let Some(old) = self.old { unsafe { libc::dup2(old, 2); libc::close(old); } } }
}
