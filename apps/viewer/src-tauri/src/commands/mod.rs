use serde::{Deserialize, Serialize};
use std::fs;
use std::io::BufWriter;
use pulldown_cmark::{Parser, Event, Tag, TagEnd, HeadingLevel, Options};

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchHit { pub page_index: usize, pub element_index: usize, pub text: String, pub context: String }

#[derive(Debug, Serialize, Deserialize)]
pub struct ValidationResult { pub valid: bool, pub errors: Vec<String>, pub warnings: Vec<String> }

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
    let mut warnings = Vec::new();

    let version = document.get("$jdf");
    if version.is_none() { errors.push("Missing required field: $jdf".into()); }
    else if !version.unwrap().is_string() { errors.push("$jdf must be a string".into()); }

    let meta = document.get("meta");
    if meta.is_none() { errors.push("Missing required field: meta".into()); }
    else {
        let m = meta.unwrap();
        if !m.is_object() { errors.push("meta must be an object".into()); }
        else if m.get("title").and_then(|t| t.as_str()).is_none() { warnings.push("meta.title is missing or empty".into()); }
    }

    let valid_types = ["text","richtext","image","table","list","shape","collapsible","toc"];
    match document.get("pages").and_then(|p| p.as_array()) {
        None => errors.push("Missing required field: pages (must be array)".into()),
        Some(arr) if arr.is_empty() => errors.push("pages is empty — at least one page required".into()),
        Some(arr) => {
            for (pi, page) in arr.iter().enumerate() {
                if !page.is_object() { errors.push(format!("page[{}] must be an object", pi)); continue; }
                match page.get("elements").and_then(|e| e.as_array()) {
                    None => errors.push(format!("page[{}].elements missing or not an array", pi)),
                    Some(els) => for (ei, el) in els.iter().enumerate() {
                        let t = el.get("type").and_then(|t| t.as_str());
                        match t {
                            None => errors.push(format!("page[{}].element[{}].type missing", pi, ei)),
                            Some(t) if !valid_types.contains(&t) => warnings.push(format!("page[{}].element[{}].type \"{}\" is not a known JDF type", pi, ei, t)),
                            _ => {}
                        }
                    }
                }
            }
        }
    }

    Ok(ValidationResult { valid: errors.is_empty(), errors, warnings })
}

#[tauri::command]
pub fn search_document(document: serde_json::Value, query: String) -> Result<Vec<SearchHit>, String> {
    let mut hits = Vec::new();
    let q = query.to_lowercase();
    if q.is_empty() { return Ok(hits); }
    if let Some(pages) = document.get("pages").and_then(|p| p.as_array()) {
        for (pi, page) in pages.iter().enumerate() {
            if let Some(elements) = page.get("elements").and_then(|e| e.as_array()) {
                for (ei, el) in elements.iter().enumerate() {
                    let text = extract_text(el);
                    let lower = text.to_lowercase();
                    if let Some(pos) = lower.find(&q) {
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

fn page_size_mm(name: &str) -> (f32, f32) {
    match name {
        "A3" => (297.0, 420.0),
        "A4" => (210.0, 297.0),
        "A5" => (148.0, 210.0),
        "Letter" => (215.9, 279.4),
        "Legal" => (215.9, 355.6),
        "Tabloid" => (279.4, 431.8),
        _ => (210.0, 297.0),
    }
}

fn resolve_page_dim(page: &serde_json::Value, document: &serde_json::Value) -> (f32, f32) {
    let meta_size = document.get("meta").and_then(|m| m.get("pageSize"));
    let page_size = page.get("pageSize").or(meta_size);
    let (mut w, mut h) = match page_size {
        Some(v) if v.is_string() => page_size_mm(v.as_str().unwrap()),
        Some(v) if v.is_object() => (
            v.get("width").and_then(|x| x.as_f64()).unwrap_or(210.0) as f32,
            v.get("height").and_then(|x| x.as_f64()).unwrap_or(297.0) as f32,
        ),
        _ => (210.0, 297.0),
    };
    let orient = page.get("pageOrientation").and_then(|o| o.as_str())
        .or_else(|| document.get("meta").and_then(|m| m.get("pageOrientation")).and_then(|o| o.as_str()))
        .unwrap_or("portrait");
    if orient == "landscape" { std::mem::swap(&mut w, &mut h); }
    (w, h)
}

fn resolve_margins(page: &serde_json::Value, document: &serde_json::Value) -> (f32, f32, f32, f32) {
    let meta_m = document.get("meta").and_then(|m| m.get("margins"));
    let page_m = page.get("margins");
    let pick = |key: &str, default: f32| -> f32 {
        page_m.and_then(|m| m.get(key)).and_then(|v| v.as_f64())
            .or_else(|| meta_m.and_then(|m| m.get(key)).and_then(|v| v.as_f64()))
            .map(|v| v as f32).unwrap_or(default)
    };
    (pick("top", 25.0), pick("right", 22.0), pick("bottom", 25.0), pick("left", 22.0))
}

fn get_color(el: &serde_json::Value, doc: &serde_json::Value) -> Option<printpdf::Rgb> {
    let style = el.get("style")?;
    if let Some(c) = style.get("color").and_then(|c| c.as_str()) { return parse_color(c); }
    if let Some(name) = style.as_str() {
        if let Some(c) = doc.get("styles").and_then(|s| s.get(name)).and_then(|s| s.get("color")).and_then(|c| c.as_str()) {
            return parse_color(c);
        }
    }
    None
}

#[tauri::command]
pub async fn export_pdf(document: serde_json::Value, path: String) -> Result<(), String> {
    use printpdf::*;
    let title = document.get("meta").and_then(|m| m.get("title")).and_then(|t| t.as_str()).unwrap_or("Document");
    let pages = document.get("pages").and_then(|p| p.as_array()).ok_or("No pages")?;
    let first_dim = pages.first().map(|p| resolve_page_dim(p, &document)).unwrap_or((210.0, 297.0));
    let (doc, first_page, first_layer) = PdfDocument::new(title, Mm(first_dim.0), Mm(first_dim.1), "Layer 1");
    let font = doc.add_builtin_font(BuiltinFont::Helvetica).map_err(|e| format!("{}", e))?;
    let font_bold = doc.add_builtin_font(BuiltinFont::HelveticaBold).map_err(|e| format!("{}", e))?;
    let font_italic = doc.add_builtin_font(BuiltinFont::HelveticaOblique).map_err(|e| format!("{}", e))?;
    let font_mono = doc.add_builtin_font(BuiltinFont::Courier).map_err(|e| format!("{}", e))?;

    for (i, page) in pages.iter().enumerate() {
        let (page_w, page_h) = resolve_page_dim(page, &document);
        let (m_top, _m_right, _m_bottom, m_left) = resolve_margins(page, &document);
        let (cp, cl) = if i == 0 { (first_page.clone(), first_layer.clone()) } else { doc.add_page(Mm(page_w), Mm(page_h), "Layer 1") };
        let layer = doc.get_page(cp).get_layer(cl);
        if let Some(elements) = page.get("elements").and_then(|e| e.as_array()) {
            for el in elements {
                draw_element(&layer, el, &document, &font, &font_bold, &font_italic, &font_mono, m_left, m_top, page_h);
            }
        }
    }
    let file = fs::File::create(&path).map_err(|e| format!("{}", e))?;
    doc.save(&mut BufWriter::new(file)).map_err(|e| format!("{}", e))?;
    Ok(())
}

fn draw_element(
    layer: &printpdf::PdfLayerReference,
    el: &serde_json::Value,
    document: &serde_json::Value,
    font: &printpdf::IndirectFontRef,
    font_bold: &printpdf::IndirectFontRef,
    font_italic: &printpdf::IndirectFontRef,
    font_mono: &printpdf::IndirectFontRef,
    margin_left: f32,
    margin_top: f32,
    page_h: f32,
) {
    use printpdf::*;
    let tp = el.get("type").and_then(|t| t.as_str()).unwrap_or("");
    let px = el.get("position").and_then(|p| p.get("x")).and_then(|x| x.as_f64()).unwrap_or(0.0) as f32;
    let py = el.get("position").and_then(|p| p.get("y")).and_then(|y| y.as_f64()).unwrap_or(0.0) as f32;
    let width = el.get("width").and_then(|w| w.as_f64()).unwrap_or(166.0) as f32;
    let fs = get_font_size(el, document) as f32;
    let bold = is_bold(el, document);
    let italic = is_italic(el, document);
    let f = if bold { font_bold } else if italic { font_italic } else { font };

    let to_pdf_y = |y: f32, line: f32| Mm(page_h - margin_top - y - line * fs * 0.4);

    if let Some(c) = get_color(el, document) {
        layer.set_fill_color(Color::Rgb(c));
    } else {
        layer.set_fill_color(Color::Rgb(Rgb::new(0.0, 0.0, 0.0, None)));
    }

    match tp {
        "text" => {
            let content = el.get("content").and_then(|c| c.as_str()).unwrap_or("");
            for (li, line) in content.split('\n').enumerate() {
                if line.trim().is_empty() { continue; }
                layer.use_text(line.to_string(), fs, Mm(margin_left + px), to_pdf_y(py, li as f32), f);
            }
        }
        "richtext" => {
            if let Some(runs) = el.get("runs").and_then(|r| r.as_array()) {
                let combined: String = runs.iter().filter_map(|r| r.get("text").and_then(|t| t.as_str())).collect::<Vec<_>>().concat();
                for (li, line) in combined.split('\n').enumerate() {
                    if line.trim().is_empty() { continue; }
                    layer.use_text(line.to_string(), fs, Mm(margin_left + px), to_pdf_y(py, li as f32), f);
                }
            }
        }
        "list" => {
            if let Some(items) = el.get("items").and_then(|i| i.as_array()) {
                let ordered = el.get("ordered").and_then(|o| o.as_bool()).unwrap_or(false)
                    || el.get("listType").and_then(|t| t.as_str()) == Some("ordered");
                for (idx, item) in items.iter().enumerate() {
                    let bullet = if ordered { format!("{}. ", idx + 1) } else { "• ".to_string() };
                    let content = item.get("content").and_then(|c| c.as_str()).unwrap_or("");
                    layer.use_text(format!("{}{}", bullet, content), fs, Mm(margin_left + px), to_pdf_y(py, idx as f32 * 1.5), f);
                }
            }
        }
        "table" => {
            let headers: Vec<String> = el.get("headers").and_then(|h| h.as_array())
                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default();
            let rows: Vec<Vec<String>> = el.get("rows").and_then(|r| r.as_array())
                .map(|a| a.iter().map(|row| {
                    row.as_array().map(|cells| cells.iter().map(|c| {
                        if let Some(s) = c.as_str() { s.to_string() }
                        else { c.get("content").and_then(|x| x.as_str()).unwrap_or("").to_string() }
                    }).collect()).unwrap_or_default()
                }).collect())
                .unwrap_or_default();
            let col_count = headers.len().max(rows.first().map(|r| r.len()).unwrap_or(0));
            if col_count == 0 { return; }
            let col_w = width / col_count as f32;
            let mut row_idx: f32 = 0.0;
            if !headers.is_empty() {
                for (ci, h) in headers.iter().enumerate() {
                    layer.use_text(h.clone(), fs, Mm(margin_left + px + ci as f32 * col_w), to_pdf_y(py, row_idx), font_bold);
                }
                row_idx += 1.5;
            }
            for row in &rows {
                for (ci, cell) in row.iter().enumerate() {
                    layer.use_text(cell.clone(), fs, Mm(margin_left + px + ci as f32 * col_w), to_pdf_y(py, row_idx), f);
                }
                row_idx += 1.5;
            }
        }
        "collapsible" => {
            let title = el.get("title").and_then(|t| t.as_str()).unwrap_or("");
            layer.use_text(format!("▶ {}", title), fs, Mm(margin_left + px), to_pdf_y(py, 0.0), font_bold);
            if el.get("expanded").and_then(|e| e.as_bool()).unwrap_or(false) {
                if let Some(children) = el.get("elements").and_then(|e| e.as_array()) {
                    for child in children {
                        draw_element(layer, child, document, font, font_bold, font_italic, font_mono, margin_left, margin_top, page_h);
                    }
                }
            }
        }
        "shape" => {
            let shape = el.get("shape").and_then(|s| s.as_str()).unwrap_or("rect");
            let h = el.get("height").and_then(|v| v.as_f64()).unwrap_or(1.0) as f32;
            if shape == "rect" {
                let line = printpdf::Line {
                    points: vec![
                        (printpdf::Point::new(Mm(margin_left + px), Mm(page_h - margin_top - py)), false),
                        (printpdf::Point::new(Mm(margin_left + px + width), Mm(page_h - margin_top - py)), false),
                        (printpdf::Point::new(Mm(margin_left + px + width), Mm(page_h - margin_top - py - h)), false),
                        (printpdf::Point::new(Mm(margin_left + px), Mm(page_h - margin_top - py - h)), false),
                    ],
                    is_closed: true,
                };
                if let Some(fill) = el.get("fill").and_then(|f| f.as_str()) {
                    if let Some(c) = parse_color(fill) {
                        layer.set_fill_color(printpdf::Color::Rgb(c));
                        layer.add_polygon(printpdf::Polygon { rings: vec![line.points.clone()], mode: printpdf::path::PaintMode::Fill, winding_order: printpdf::path::WindingOrder::NonZero });
                    }
                }
            }
        }
        "toc" => {
            if let Some(pages) = document.get("pages").and_then(|p| p.as_array()) {
                let depth = el.get("depth").and_then(|d| d.as_u64()).unwrap_or(6) as u8;
                let mut row: f32 = 0.0;
                for (pi, page) in pages.iter().enumerate() {
                    if let Some(elements) = page.get("elements").and_then(|e| e.as_array()) {
                        for ce in elements {
                            if ce.get("type").and_then(|t| t.as_str()) != Some("text") { continue; }
                            let level = ce.get("tocLevel").and_then(|l| l.as_u64())
                                .or_else(|| ce.get("heading").and_then(|h| h.as_u64()))
                                .unwrap_or(1) as u8;
                            if level > depth { continue; }
                            let title = ce.get("tocEntry").and_then(|t| t.as_str())
                                .or_else(|| if ce.get("heading").is_some() { ce.get("content").and_then(|c| c.as_str()) } else { None });
                            if let Some(t) = title {
                                let indent = (level as f32 - 1.0) * 4.0;
                                layer.use_text(t.to_string(), fs, Mm(margin_left + px + indent), to_pdf_y(py, row), f);
                                layer.use_text(format!("{}", pi + 1), fs, Mm(margin_left + px + width - 8.0), to_pdf_y(py, row), f);
                                row += 1.4;
                            }
                        }
                    }
                }
            }
        }
        "image" => {
            let label = el.get("alt").and_then(|a| a.as_str()).unwrap_or("[image]");
            layer.use_text(format!("[{}]", label), fs, Mm(margin_left + px), to_pdf_y(py, 0.0), font_italic);
        }
        _ => {}
    }
}

fn parse_color(s: &str) -> Option<printpdf::Rgb> {
    let s = s.trim_start_matches('#');
    if s.len() == 6 {
        let r = u8::from_str_radix(&s[0..2], 16).ok()? as f32 / 255.0;
        let g = u8::from_str_radix(&s[2..4], 16).ok()? as f32 / 255.0;
        let b = u8::from_str_radix(&s[4..6], 16).ok()? as f32 / 255.0;
        return Some(printpdf::Rgb::new(r, g, b, None));
    }
    None
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
        let is_bullet = block.lines().all(|l| {
            let t = l.trim();
            t.starts_with('●') || t.starts_with('•') || t.starts_with('○') || t.starts_with("* ")
        }) && block.lines().count() >= 2;
        let is_heading = !is_bullet && block.len() < 80 && !block.contains('.') &&
            (first || block.chars().filter(|c| c.is_uppercase()).count() as f64 / block.len().max(1) as f64 > 0.4);
        let h = if is_heading { 10.0 } else if is_bullet { block.lines().count() as f64 * 5.0 + 3.0 } else { (block.len() as f64 / 80.0).ceil() * 4.5 + 3.0 };

        if y + h > max_y && !els.is_empty() {
            pages.push(serde_json::json!({"id": format!("page-{}", pn), "elements": els}));
            els = Vec::new(); y = 5.0; pn += 1;
        }

        if is_bullet {
            let items: Vec<serde_json::Value> = block.lines().map(|l| l.trim().trim_start_matches(|c:char| "●•○* ".contains(c)).trim())
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

    let mut runs: Vec<serde_json::Value> = Vec::new();
    let mut current_text = String::new();
    let mut hlevel: u8 = 1;
    let mut in_list = false;
    let mut ordered = false;
    let mut items: Vec<serde_json::Value> = Vec::new();
    let mut in_code = false;
    let mut code = String::new();
    let mut in_table = false;
    let mut table_headers: Vec<String> = Vec::new();
    let mut table_rows: Vec<Vec<String>> = Vec::new();
    let mut current_row: Vec<String> = Vec::new();
    let mut in_table_head = false;
    let mut in_blockquote = false;
    let mut blockquote_text = String::new();
    let mut bold_depth = 0u8;
    let mut italic_depth = 0u8;
    let mut current_link: Option<String> = None;

    let mut opts = Options::empty();
    opts.insert(Options::ENABLE_TABLES);
    opts.insert(Options::ENABLE_STRIKETHROUGH);
    opts.insert(Options::ENABLE_TASKLISTS);
    let parser = Parser::new_ext(md, opts);

    let flush_run = |runs: &mut Vec<serde_json::Value>, current_text: &mut String, bold: u8, italic: u8, link: &Option<String>| {
        if current_text.is_empty() { return; }
        let mut run = serde_json::json!({"text": current_text.clone()});
        if bold > 0 { run["bold"] = serde_json::json!(true); }
        if italic > 0 { run["italic"] = serde_json::json!(true); }
        if let Some(l) = link { run["link"] = serde_json::json!(l); }
        runs.push(run);
        current_text.clear();
    };

    for event in parser {
        match event {
            Event::Start(Tag::Heading { level, .. }) => {
                hlevel = match level { HeadingLevel::H1=>1, HeadingLevel::H2=>2, HeadingLevel::H3=>3, HeadingLevel::H4=>4, HeadingLevel::H5=>5, _=>6 };
            }
            Event::End(TagEnd::Heading(_)) => {
                let sz = match hlevel { 1=>22.0, 2=>16.0, 3=>13.0, 4=>11.0, _=>10.0 };
                let h = sz * 0.6 + 6.0;
                if y + h > max_y && !els.is_empty() { pages.push(serde_json::json!({"id":format!("page-{}",pn),"elements":els})); els=Vec::new(); y=5.0; pn+=1; }
                if y > 10.0 && hlevel <= 2 { els.push(serde_json::json!({"type":"shape","shape":"rect","position":{"x":0,"y":y},"width":w,"height":0.3,"fill":"#e2e8f0"})); y+=4.0; }
                els.push(serde_json::json!({"type":"text","content":current_text.trim(),"position":{"x":0,"y":y},"width":w,"heading":hlevel,"tocEntry":current_text.trim(),"tocLevel":hlevel,"style":{"fontFamily":"Inter","fontSize":sz,"fontWeight":"bold","color":if hlevel<=2{"#0f172a"}else{"#1e293b"}}}));
                y += h; current_text.clear();
            }
            Event::Start(Tag::List(o)) => { flush_paragraph(&mut runs, &mut current_text, &mut els, &mut y, w, max_y, &mut pages, &mut pn, bold_depth, italic_depth, &current_link); in_list=true; ordered=o.is_some(); items.clear(); }
            Event::End(TagEnd::List(_)) => {
                if !items.is_empty() {
                    let h = items.len() as f64 * 5.0 + 3.0;
                    if y+h>max_y&&!els.is_empty() { pages.push(serde_json::json!({"id":format!("page-{}",pn),"elements":els})); els=Vec::new(); y=5.0; pn+=1; }
                    els.push(serde_json::json!({"type":"list","listType":if ordered{"ordered"}else{"unordered"},"position":{"x":0,"y":y},"width":w,"style":{"fontFamily":"Inter","fontSize":10,"lineHeight":1.6,"color":"#334155"},"items":items.clone()}));
                    y += h;
                }
                in_list=false; items.clear();
            }
            Event::Start(Tag::Item) => { current_text.clear(); }
            Event::End(TagEnd::Item) => { items.push(serde_json::json!({"content":current_text.trim()})); current_text.clear(); }
            Event::Start(Tag::CodeBlock(_)) => { flush_paragraph(&mut runs, &mut current_text, &mut els, &mut y, w, max_y, &mut pages, &mut pn, bold_depth, italic_depth, &current_link); in_code=true; code.clear(); }
            Event::End(TagEnd::CodeBlock) => {
                let h = code.lines().count().max(1) as f64 * 4.0 + 8.0;
                if y+h>max_y&&!els.is_empty() { pages.push(serde_json::json!({"id":format!("page-{}",pn),"elements":els})); els=Vec::new(); y=5.0; pn+=1; }
                els.push(serde_json::json!({"type":"text","content":code.trim_end(),"position":{"x":0,"y":y},"width":w,"style":{"fontFamily":"JetBrains Mono","fontSize":9,"color":"#1e293b","backgroundColor":"#f1f5f9","padding":8,"borderRadius":4,"lineHeight":1.5}}));
                y += h; in_code = false;
            }
            Event::Start(Tag::Table(_)) => { flush_paragraph(&mut runs, &mut current_text, &mut els, &mut y, w, max_y, &mut pages, &mut pn, bold_depth, italic_depth, &current_link); in_table = true; table_headers.clear(); table_rows.clear(); }
            Event::End(TagEnd::Table) => {
                let h = (table_rows.len() + 1) as f64 * 7.0 + 3.0;
                if y+h>max_y&&!els.is_empty() { pages.push(serde_json::json!({"id":format!("page-{}",pn),"elements":els})); els=Vec::new(); y=5.0; pn+=1; }
                els.push(serde_json::json!({"type":"table","headers":table_headers.clone(),"rows":table_rows.clone(),"position":{"x":0,"y":y},"width":w,"borders":true,"style":{"fontFamily":"Inter","fontSize":10}}));
                y += h; in_table = false;
            }
            Event::Start(Tag::TableHead) => { in_table_head = true; current_row.clear(); }
            Event::End(TagEnd::TableHead) => { in_table_head = false; table_headers = current_row.clone(); current_row.clear(); }
            Event::Start(Tag::TableRow) => { current_row.clear(); }
            Event::End(TagEnd::TableRow) => { if !in_table_head { table_rows.push(current_row.clone()); } current_row.clear(); }
            Event::Start(Tag::TableCell) => { current_text.clear(); }
            Event::End(TagEnd::TableCell) => { current_row.push(current_text.trim().to_string()); current_text.clear(); }
            Event::Start(Tag::BlockQuote(_)) => { flush_paragraph(&mut runs, &mut current_text, &mut els, &mut y, w, max_y, &mut pages, &mut pn, bold_depth, italic_depth, &current_link); in_blockquote = true; blockquote_text.clear(); }
            Event::End(TagEnd::BlockQuote(_)) => {
                let h = (blockquote_text.len() as f64 / 70.0).ceil() * 4.5 + 6.0;
                if y+h>max_y&&!els.is_empty() { pages.push(serde_json::json!({"id":format!("page-{}",pn),"elements":els})); els=Vec::new(); y=5.0; pn+=1; }
                els.push(serde_json::json!({"type":"text","content":blockquote_text.trim(),"position":{"x":0,"y":y},"width":w,"style":{"fontFamily":"Inter","fontSize":10,"lineHeight":1.6,"color":"#475569","fontStyle":"italic","backgroundColor":"#f8fafc","padding":10,"borderRadius":6,"marginTop":4}}));
                y += h; in_blockquote = false;
            }
            Event::Start(Tag::Strong) => { flush_run(&mut runs, &mut current_text, bold_depth, italic_depth, &current_link); bold_depth += 1; }
            Event::End(TagEnd::Strong) => { flush_run(&mut runs, &mut current_text, bold_depth, italic_depth, &current_link); if bold_depth > 0 { bold_depth -= 1; } }
            Event::Start(Tag::Emphasis) => { flush_run(&mut runs, &mut current_text, bold_depth, italic_depth, &current_link); italic_depth += 1; }
            Event::End(TagEnd::Emphasis) => { flush_run(&mut runs, &mut current_text, bold_depth, italic_depth, &current_link); if italic_depth > 0 { italic_depth -= 1; } }
            Event::Start(Tag::Link { dest_url, .. }) => { flush_run(&mut runs, &mut current_text, bold_depth, italic_depth, &current_link); current_link = Some(dest_url.to_string()); }
            Event::End(TagEnd::Link) => { flush_run(&mut runs, &mut current_text, bold_depth, italic_depth, &current_link); current_link = None; }
            Event::Start(Tag::Image { dest_url, title: img_title, .. }) => {
                if y+30.0>max_y&&!els.is_empty() { pages.push(serde_json::json!({"id":format!("page-{}",pn),"elements":els})); els=Vec::new(); y=5.0; pn+=1; }
                els.push(serde_json::json!({"type":"image","src":dest_url.to_string(),"alt":img_title.to_string(),"position":{"x":0,"y":y},"width":w,"height":40,"fit":"contain"}));
                y += 44.0;
            }
            Event::End(TagEnd::Image) => {}
            Event::End(TagEnd::Paragraph) => {
                if !in_list && !in_table && !in_blockquote {
                    flush_paragraph(&mut runs, &mut current_text, &mut els, &mut y, w, max_y, &mut pages, &mut pn, bold_depth, italic_depth, &current_link);
                }
            }
            Event::Text(t) => {
                if in_code { code.push_str(&t); }
                else if in_blockquote { blockquote_text.push_str(&t); }
                else { current_text.push_str(&t); }
            }
            Event::Code(c) => {
                flush_run(&mut runs, &mut current_text, bold_depth, italic_depth, &current_link);
                runs.push(serde_json::json!({"text": c.to_string(), "fontFamily":"JetBrains Mono", "color":"#be185d"}));
            }
            Event::SoftBreak | Event::HardBreak => { current_text.push(' '); }
            Event::Rule => {
                if y+5.0>max_y&&!els.is_empty() { pages.push(serde_json::json!({"id":format!("page-{}",pn),"elements":els})); els=Vec::new(); y=5.0; pn+=1; }
                els.push(serde_json::json!({"type":"shape","shape":"rect","position":{"x":0,"y":y+2.0},"width":w,"height":0.3,"fill":"#cbd5e1"}));
                y += 6.0;
            }
            _ => {}
        }
    }
    flush_paragraph(&mut runs, &mut current_text, &mut els, &mut y, w, max_y, &mut pages, &mut pn, bold_depth, italic_depth, &current_link);

    if !els.is_empty() { pages.push(serde_json::json!({"id":format!("page-{}",pn),"elements":els})); }
    if pages.is_empty() { pages.push(serde_json::json!({"id":"page-1","elements":[{"type":"text","content":"(Empty)","position":{"x":0,"y":20},"width":166,"style":{"fontSize":11,"color":"#94a3b8"}}]})); }
    serde_json::json!({"$jdf":"1.0.0","meta":{"title":title,"pageSize":"A4","unit":"mm","margins":{"top":25,"right":22,"bottom":25,"left":22}},"styles":{"heading":{"fontFamily":"Inter","fontSize":22,"fontWeight":"bold","color":"#0f172a"},"body":{"fontFamily":"Inter","fontSize":10,"lineHeight":1.6,"color":"#334155"}},"pages":pages})
}

fn flush_paragraph(
    runs: &mut Vec<serde_json::Value>,
    current_text: &mut String,
    els: &mut Vec<serde_json::Value>,
    y: &mut f64,
    w: f64,
    max_y: f64,
    pages: &mut Vec<serde_json::Value>,
    pn: &mut usize,
    bold: u8,
    italic: u8,
    link: &Option<String>,
) {
    if !current_text.is_empty() {
        let mut run = serde_json::json!({"text": current_text.clone()});
        if bold > 0 { run["bold"] = serde_json::json!(true); }
        if italic > 0 { run["italic"] = serde_json::json!(true); }
        if let Some(l) = link { run["link"] = serde_json::json!(l); }
        runs.push(run);
        current_text.clear();
    }
    if runs.is_empty() { return; }
    let total_text: String = runs.iter().filter_map(|r| r.get("text").and_then(|t| t.as_str())).collect::<Vec<_>>().join("");
    let h = (total_text.len() as f64 / 80.0).ceil().max(1.0) * 4.5 + 4.0;
    if *y + h > max_y && !els.is_empty() {
        pages.push(serde_json::json!({"id": format!("page-{}", pn), "elements": els.clone()}));
        els.clear();
        *y = 5.0;
        *pn += 1;
    }
    let has_formatting = runs.iter().any(|r| r.get("bold").is_some() || r.get("italic").is_some() || r.get("link").is_some() || r.get("fontFamily").is_some());
    if has_formatting {
        els.push(serde_json::json!({"type":"richtext","runs":runs.clone(),"position":{"x":0,"y":*y},"width":w,"style":{"fontFamily":"Inter","fontSize":10,"lineHeight":1.6,"color":"#334155"}}));
    } else {
        els.push(serde_json::json!({"type":"text","content":total_text,"position":{"x":0,"y":*y},"width":w,"style":{"fontFamily":"Inter","fontSize":10,"lineHeight":1.6,"color":"#334155"}}));
    }
    *y += h;
    runs.clear();
}

fn extract_text(el: &serde_json::Value) -> String {
    if let Some(c) = el.get("content").and_then(|c| c.as_str()) { return c.to_string(); }
    if let Some(runs) = el.get("runs").and_then(|r| r.as_array()) {
        return runs.iter().filter_map(|r| r.get("text").and_then(|t| t.as_str())).collect::<Vec<_>>().concat();
    }
    if let Some(items) = el.get("items").and_then(|i| i.as_array()) {
        return items.iter().filter_map(|i| i.get("content").and_then(|c| c.as_str())).collect::<Vec<_>>().join(" ");
    }
    if let Some(rows) = el.get("rows").and_then(|r| r.as_array()) {
        let mut all = String::new();
        for row in rows.iter().filter_map(|r| r.as_array()) {
            for cell in row {
                if let Some(s) = cell.as_str() { all.push_str(s); all.push(' '); }
                else if let Some(s) = cell.get("content").and_then(|c| c.as_str()) { all.push_str(s); all.push(' '); }
            }
        }
        return all;
    }
    if let Some(t) = el.get("title").and_then(|t| t.as_str()) { return t.to_string(); }
    String::new()
}

fn get_font_size(el: &serde_json::Value, doc: &serde_json::Value) -> f64 {
    if let Some(s) = el.get("style") {
        if let Some(sz) = s.get("fontSize").and_then(|v| v.as_f64()) { return sz; }
        if let Some(name) = s.as_str() {
            if let Some(sz) = doc.get("styles").and_then(|ss| ss.get(name)).and_then(|s| s.get("fontSize")).and_then(|v| v.as_f64()) { return sz; }
        }
    }
    10.5
}

fn is_bold(el: &serde_json::Value, doc: &serde_json::Value) -> bool {
    if let Some(s) = el.get("style") {
        if let Some(w) = s.get("fontWeight").and_then(|v| v.as_str()) { return w == "bold" || w == "600" || w == "700" || w == "800" || w == "900"; }
        if let Some(name) = s.as_str() {
            if let Some(w) = doc.get("styles").and_then(|ss| ss.get(name)).and_then(|s| s.get("fontWeight")).and_then(|v| v.as_str()) {
                return w == "bold" || w == "600" || w == "700" || w == "800" || w == "900";
            }
        }
    }
    if let Some(h) = el.get("heading") {
        if h.is_boolean() { return h.as_bool().unwrap_or(false); }
        if h.is_number() { return true; }
    }
    false
}

fn is_italic(el: &serde_json::Value, doc: &serde_json::Value) -> bool {
    if let Some(s) = el.get("style") {
        if let Some(st) = s.get("fontStyle").and_then(|v| v.as_str()) { return st == "italic"; }
        if let Some(name) = s.as_str() {
            if let Some(st) = doc.get("styles").and_then(|ss| ss.get(name)).and_then(|s| s.get("fontStyle")).and_then(|v| v.as_str()) { return st == "italic"; }
        }
    }
    false
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
