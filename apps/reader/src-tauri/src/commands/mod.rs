use serde::{Deserialize, Serialize};
use std::fs;
use std::io::BufWriter;
use std::path::{Path, PathBuf};
use pulldown_cmark::{Parser, Event, Tag, TagEnd, HeadingLevel, Options};

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchHit { pub page_index: usize, pub element_index: usize, pub text: String, pub context: String }

#[derive(Debug, Serialize, Deserialize)]
pub struct ValidationResult { pub valid: bool, pub errors: Vec<String>, pub warnings: Vec<String> }

/// Reject path arguments that point outside the user-document zones the
/// fs capabilities allow. The IPC layer doesn't enforce capability scope on
/// raw `String` args (capabilities only apply to `@tauri-apps/plugin-fs`),
/// so a malicious frontend / compromised .jdfx could otherwise call
/// `invoke("open_document", { path: "/etc/passwd" })` and read it.
///
/// Allowed roots: $HOME/{Downloads,Documents,Desktop} and /tmp. Anything
/// else, including `..` traversal, is rejected before fs::read.
fn ensure_path_in_user_zone(path: &str) -> Result<PathBuf, String> {
    let p = Path::new(path);
    let canon = match p.canonicalize() {
        Ok(c) => c,
        Err(_) => {
            // Path may not exist yet (save_document creating a new file). Walk
            // up to the first existing ancestor and canonicalize that, then
            // re-attach the unresolved tail.
            let mut anc = p.to_path_buf();
            let mut tail = PathBuf::new();
            loop {
                if anc.exists() {
                    let base = anc.canonicalize().map_err(|e| format!("Path resolve failed: {}", e))?;
                    return validate_canonical(&base.join(tail), path);
                }
                let name = anc.file_name().ok_or_else(|| format!("Bad path: {}", path))?.to_owned();
                tail = Path::new(&name).join(&tail);
                if !anc.pop() { return Err(format!("Bad path: {}", path)); }
            }
        }
    };
    validate_canonical(&canon, path)
}

fn validate_canonical(canon: &Path, original: &str) -> Result<PathBuf, String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let allowed: Vec<PathBuf> = vec![
        format!("{}/Downloads", home).into(),
        format!("{}/Documents", home).into(),
        format!("{}/Desktop", home).into(),
        PathBuf::from("/tmp"),
        PathBuf::from("/private/tmp"), // macOS canonicalises /tmp to /private/tmp
    ];
    for root in &allowed {
        if canon.starts_with(root) { return Ok(canon.to_path_buf()); }
    }
    Err(format!(
        "Path is outside the allowed user zones (Downloads / Documents / Desktop / tmp): {}",
        original
    ))
}

#[tauri::command]
pub fn open_document(path: String) -> Result<serde_json::Value, String> {
    let safe = ensure_path_in_user_zone(&path)?;
    let content = fs::read_to_string(&safe).map_err(|e| format!("Failed to read: {}", e))?;
    let doc: serde_json::Value = serde_json::from_str(&content).map_err(|e| format!("Invalid JSON: {}", e))?;
    if doc.get("$jdf").is_none() { return Err("Not a JDF document".to_string()); }
    Ok(doc)
}

#[tauri::command]
pub fn save_document(path: String, document: serde_json::Value) -> Result<(), String> {
    let safe = ensure_path_in_user_zone(&path)?;
    let content = serde_json::to_string_pretty(&document).map_err(|e| format!("{}", e))?;
    fs::write(&safe, content).map_err(|e| format!("{}", e))?;
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
                    if let Some((ctx_start, ctx_end)) = find_context_bounds(&text, &q) {
                        hits.push(SearchHit {
                            page_index: pi,
                            element_index: ei,
                            text: query.clone(),
                            context: text[ctx_start..ctx_end].to_string(),
                        });
                    }
                }
            }
        }
    }
    Ok(hits)
}

/// Case-insensitive substring search that returns char-boundary-safe context
/// bounds in the *original* text. Naively `lower.find(&q)` then slicing the
/// original string can panic on Turkish "İ" (lowercases to two-byte "i̇") or
/// German "ß" (→"ss") because byte positions diverge after case folding.
///
/// We walk char-by-char, tracking how each char maps to its lowercase
/// expansion, then translate match offsets in the lower string back to byte
/// offsets in the original. The 20-byte context window is then snapped to
/// the nearest char boundaries.
fn find_context_bounds(text: &str, query_lower: &str) -> Option<(usize, usize)> {
    if query_lower.is_empty() { return None; }
    // Build (byte_in_text, byte_in_lower) checkpoints for every original char.
    let mut lower = String::with_capacity(text.len());
    let mut map: Vec<(usize, usize)> = Vec::with_capacity(text.len());
    for (b, ch) in text.char_indices() {
        map.push((b, lower.len()));
        for low_ch in ch.to_lowercase() {
            lower.push(low_ch);
        }
    }
    // Sentinel — points one past the end so we can resolve the trailing edge.
    map.push((text.len(), lower.len()));

    let lower_pos = lower.find(query_lower)?;
    let lower_end = lower_pos + query_lower.len();

    // Walk the checkpoint table to find char-aligned slice bounds in the original.
    let match_start_byte = map.iter().find(|(_, lp)| *lp >= lower_pos)
        .map(|(tb, _)| *tb)
        .unwrap_or(text.len());
    let match_end_byte = map.iter().find(|(_, lp)| *lp >= lower_end)
        .map(|(tb, _)| *tb)
        .unwrap_or(text.len());

    let ctx_start = snap_to_char_boundary(text, match_start_byte.saturating_sub(20), false);
    let ctx_end = snap_to_char_boundary(text, (match_end_byte + 20).min(text.len()), true);
    Some((ctx_start, ctx_end))
}

fn snap_to_char_boundary(s: &str, mut idx: usize, forward: bool) -> usize {
    if idx >= s.len() { return s.len(); }
    while idx > 0 && !s.is_char_boundary(idx) {
        if forward { idx += 1; if idx >= s.len() { return s.len(); } }
        else { idx -= 1; }
    }
    idx
}

#[tauri::command]
pub async fn import_pdf(path: String) -> Result<serde_json::Value, String> {
    let safe = ensure_path_in_user_zone(&path)?;
    let bytes = fs::read(&safe).map_err(|e| format!("Failed to read: {}", e))?;
    let text = tokio::task::spawn_blocking(move || {
        let _g = suppress_stderr();
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| pdf_extract::extract_text_from_mem(&bytes)))
    }).await.map_err(|e| format!("{}", e))?.map_err(|_| "PDF parse crashed".to_string())?.map_err(|e| format!("{}", e))?;

    let title = std::path::Path::new(&path).file_stem().and_then(|s| s.to_str()).unwrap_or("Imported").to_string();
    Ok(text_to_jdf(&text, &title))
}

#[tauri::command]
pub fn import_markdown(path: String) -> Result<serde_json::Value, String> {
    let safe = ensure_path_in_user_zone(&path)?;
    let content = fs::read_to_string(&safe).map_err(|e| format!("{}", e))?;
    let title = std::path::Path::new(&path).file_stem().and_then(|s| s.to_str()).unwrap_or("Document").to_string();
    Ok(markdown_to_jdf(&content, &title))
}

/// Convert a Markdown string already loaded by the frontend (e.g. with
/// relative image references rewritten to `data:` URLs) into a JDF document.
#[tauri::command]
pub fn import_markdown_content(content: String, title: String) -> Result<serde_json::Value, String> {
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

    // page_h, margin_top, y are mm. `fs` is in pt; convert to mm before
    // multiplying by line spacing. 1pt ≈ 0.3528mm; default line-height 1.2.
    // The previous formula (`line * fs * 0.4`) treated pt-as-mm and produced
    // line spacing roughly 6× too tight on small text and 2.83× too loose
    // on large text after compounding with the page conversion.
    const PT_TO_MM: f32 = 0.3528;
    const LINE_HEIGHT: f32 = 1.2;
    let line_mm = fs * PT_TO_MM * LINE_HEIGHT;
    let to_pdf_y = |y: f32, line: f32| Mm(page_h - margin_top - y - line * line_mm);

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
            // Default to expanded=true when the field is missing. The previous
            // default-false behaviour silently dropped children from PDF
            // export whenever a generated document didn't explicitly set the
            // flag (most LLM-emitted JSON, every `jdf import file.json` path).
            // Authors who want a closed export must set `expanded: false`
            // deliberately.
            let expanded = el.get("expanded").and_then(|e| e.as_bool()).unwrap_or(true);
            let glyph = if expanded { "▼" } else { "▶" };
            layer.use_text(format!("{} {}", glyph, title), fs, Mm(margin_left + px), to_pdf_y(py, 0.0), font_bold);
            if expanded {
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
            let fill = el.get("fill").and_then(|f| f.as_str()).and_then(parse_color);
            let stroke_obj = el.get("stroke");
            let stroke_color = stroke_obj
                .and_then(|s| s.get("color").and_then(|c| c.as_str()))
                .and_then(parse_color);
            let stroke_width = stroke_obj
                .and_then(|s| s.get("width").and_then(|w| w.as_f64()))
                .unwrap_or(0.3) as f32;
            let mode = match (fill.is_some(), stroke_color.is_some()) {
                (true, true) => printpdf::path::PaintMode::FillStroke,
                (true, false) => printpdf::path::PaintMode::Fill,
                (false, true) => printpdf::path::PaintMode::Stroke,
                (false, false) => printpdf::path::PaintMode::Fill,
            };
            if let Some(c) = fill {
                layer.set_fill_color(printpdf::Color::Rgb(c));
            }
            if let Some(c) = stroke_color {
                layer.set_outline_color(printpdf::Color::Rgb(c));
                layer.set_outline_thickness(stroke_width.max(0.05) as f32);
            }
            let xa = margin_left + px;
            let ya = page_h - margin_top - py;
            let xb = xa + width;
            let yb = ya - h;
            match shape {
                "rect" => {
                    let pts = vec![
                        (printpdf::Point::new(Mm(xa), Mm(ya)), false),
                        (printpdf::Point::new(Mm(xb), Mm(ya)), false),
                        (printpdf::Point::new(Mm(xb), Mm(yb)), false),
                        (printpdf::Point::new(Mm(xa), Mm(yb)), false),
                    ];
                    layer.add_polygon(printpdf::Polygon {
                        rings: vec![pts],
                        mode,
                        winding_order: printpdf::path::WindingOrder::NonZero,
                    });
                }
                "line" => {
                    let pts = vec![
                        (printpdf::Point::new(Mm(xa), Mm(ya)), false),
                        (printpdf::Point::new(Mm(xb), Mm(yb)), false),
                    ];
                    layer.add_line(printpdf::Line { points: pts, is_closed: false });
                }
                "circle" | "ellipse" => {
                    // Approximate circle/ellipse with a 16-segment cubic Bezier ring.
                    // printpdf doesn't expose a native ellipse primitive, so we
                    // emit a polygon with quadratic-ish points; good enough for export.
                    let cx = xa + width / 2.0;
                    let cy = ya - h / 2.0;
                    let rx = width / 2.0;
                    let ry = if shape == "circle" { rx } else { h / 2.0 };
                    let n = 32;
                    let mut pts = Vec::with_capacity(n);
                    for i in 0..n {
                        let theta = (i as f32) * 2.0 * std::f32::consts::PI / (n as f32);
                        let x = cx + rx * theta.cos();
                        let y = cy + ry * theta.sin();
                        pts.push((printpdf::Point::new(Mm(x), Mm(y)), false));
                    }
                    layer.add_polygon(printpdf::Polygon {
                        rings: vec![pts],
                        mode,
                        winding_order: printpdf::path::WindingOrder::NonZero,
                    });
                }
                "path" => {
                    // Element-local SVG path. Parse M/L commands into a polyline;
                    // C/Q segments are flattened to their end-point (printpdf doesn't
                    // expose Bezier curves at this layer). Loses curvature but keeps
                    // the path's overall trajectory and bounding shape.
                    if let Some(d) = el.get("path").and_then(|p| p.as_str()) {
                        let pts = svg_path_to_points(d, xa, ya, h);
                        if pts.len() >= 2 {
                            let is_closed = d.trim_end().ends_with('Z') || d.trim_end().ends_with('z');
                            if is_closed {
                                layer.add_polygon(printpdf::Polygon {
                                    rings: vec![pts],
                                    mode,
                                    winding_order: printpdf::path::WindingOrder::NonZero,
                                });
                            } else {
                                layer.add_line(printpdf::Line { points: pts, is_closed: false });
                            }
                        }
                    }
                }
                _ => {}
            }
        }
        "toc" => {
            if let Some(pages) = document.get("pages").and_then(|p| p.as_array()) {
                let depth = el.get("depth").and_then(|d| d.as_u64()).unwrap_or(6) as u8;
                let mut row: f32 = 0.0;
                for (pi, page) in pages.iter().enumerate() {
                    if let Some(elements) = page.get("elements").and_then(|e| e.as_array()) {
                        for ce in elements {
                            // Accept both `text` (with content) and `richtext`
                            // (with runs) headings — the previous version
                            // skipped richtext entirely, dropping any heading
                            // that had bold/italic emphasis from the TOC.
                            let kind = ce.get("type").and_then(|t| t.as_str()).unwrap_or("");
                            if kind != "text" && kind != "richtext" { continue; }
                            let heading_node = ce.get("heading");
                            let has_heading = heading_node.is_some()
                                && !matches!(heading_node, Some(serde_json::Value::Null))
                                && !matches!(heading_node, Some(serde_json::Value::Bool(false)));
                            if !has_heading && ce.get("tocEntry").is_none() { continue; }
                            // tocLevel takes precedence; otherwise pull level
                            // from the heading field — supports both number
                            // (1..6) and bool true (treat as level 1).
                            let level = ce.get("tocLevel").and_then(|l| l.as_u64())
                                .or_else(|| heading_node.and_then(|h| h.as_u64()))
                                .or_else(|| match heading_node { Some(serde_json::Value::Bool(true)) => Some(1u64), _ => None })
                                .unwrap_or(1) as u8;
                            if level == 0 || level > depth { continue; }
                            // Title: tocEntry overrides; for text fall back to
                            // content, for richtext concatenate run.text.
                            let runs_title: Option<String> = if kind == "richtext" {
                                ce.get("runs").and_then(|r| r.as_array()).map(|runs| {
                                    runs.iter()
                                        .filter_map(|r| r.get("text").and_then(|t| t.as_str()))
                                        .collect::<Vec<_>>()
                                        .concat()
                                })
                            } else { None };
                            let title_owned: Option<String> = ce.get("tocEntry").and_then(|t| t.as_str()).map(|s| s.to_string())
                                .or_else(|| if kind == "text" {
                                    ce.get("content").and_then(|c| c.as_str()).map(|s| s.to_string())
                                } else {
                                    runs_title
                                });
                            if let Some(t) = title_owned {
                                let indent = (level as f32 - 1.0) * 4.0;
                                layer.use_text(t.clone(), fs, Mm(margin_left + px + indent), to_pdf_y(py, row), f);
                                layer.use_text(format!("{}", pi + 1), fs, Mm(margin_left + px + width - 8.0), to_pdf_y(py, row), f);
                                row += 1.4;
                            }
                        }
                    }
                }
            }
        }
        "image" => {
            let h_mm = el.get("height").and_then(|v| v.as_f64()).unwrap_or(40.0) as f32;
            let resource_key = el.get("resource").and_then(|s| s.as_str());
            let src = el.get("src").and_then(|s| s.as_str());
            let mut embedded = false;
            if let Some(key) = resource_key {
                if let Some(b64) = document.get("resources")
                    .and_then(|r| r.get("images"))
                    .and_then(|i| i.get(key))
                    .and_then(|im| im.get("data"))
                    .and_then(|d| d.as_str())
                {
                    if try_embed_image(layer, b64, margin_left + px, page_h - margin_top - py - h_mm, width, h_mm).is_ok() {
                        embedded = true;
                    }
                }
            }
            if !embedded {
                if let Some(s) = src.filter(|s| s.starts_with("data:")) {
                    let comma = s.find(',').unwrap_or(0);
                    if comma > 0 {
                        let b64 = &s[comma + 1..];
                        if try_embed_image(layer, b64, margin_left + px, page_h - margin_top - py - h_mm, width, h_mm).is_ok() {
                            embedded = true;
                        }
                    }
                }
            }
            if !embedded {
                let label = el.get("alt").and_then(|a| a.as_str()).unwrap_or("image");
                layer.use_text(format!("[{}]", label), fs, Mm(margin_left + px), to_pdf_y(py, 0.0), font_italic);
            }
        }
        _ => {}
    }
}

fn try_embed_image(
    layer: &printpdf::PdfLayerReference,
    b64: &str,
    x_mm: f32,
    y_mm_from_bottom: f32,
    target_w_mm: f32,
    target_h_mm: f32,
) -> Result<(), String> {
    use base64::Engine;
    use printpdf::*;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64.trim())
        .map_err(|e| format!("base64 decode: {}", e))?;
    // Decode using `image` crate's generic loader — covers PNG, JPEG, BMP,
    // GIF, WebP, TIFF, AVIF, ICO without us hand-rolling a magic-byte switch.
    // The crate sniffs the format from the bytes themselves; an unknown blob
    // returns an Err that we surface unchanged.
    let img: image_crate::DynamicImage = image_crate::load_from_memory(&bytes)
        .map_err(|e| format!("image decode: {}", e))?;
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    if w == 0 || h == 0 { return Err("zero-size image".into()); }
    // Build printpdf ImageXObject manually
    let raw = rgba.into_raw();
    // printpdf expects RGB or RGBA depending on color_space; use RGB by stripping alpha against white
    let mut rgb = Vec::with_capacity((w * h * 3) as usize);
    for px_row in raw.chunks_exact(4) {
        let a = px_row[3] as f32 / 255.0;
        let blend = |c: u8| -> u8 {
            ((c as f32) * a + 255.0 * (1.0 - a)).round().clamp(0.0, 255.0) as u8
        };
        rgb.push(blend(px_row[0]));
        rgb.push(blend(px_row[1]));
        rgb.push(blend(px_row[2]));
    }
    let xobject = ImageXObject {
        width: Px(w as usize),
        height: Px(h as usize),
        color_space: ColorSpace::Rgb,
        bits_per_component: ColorBits::Bit8,
        interpolate: true,
        image_data: rgb,
        image_filter: None,
        smask: None,
        clipping_bbox: None,
    };
    let pdf_image = Image { image: xobject };
    // Compute scale to fit target_w x target_h in mm.
    // printpdf's Image renders at 1 px = 1/dpi inch. The default dpi is 300 in printpdf.
    // We instead use scale_x/scale_y so that w_mm = w_px * 25.4 / 300 * scale_x → scale_x = target_w_mm * 300 / 25.4 / w
    let dpi = 300.0_f32;
    let scale_x = target_w_mm * dpi / 25.4 / (w as f32);
    let scale_y = target_h_mm * dpi / 25.4 / (h as f32);
    pdf_image.add_to_layer(
        layer.clone(),
        ImageTransform {
            translate_x: Some(Mm(x_mm)),
            translate_y: Some(Mm(y_mm_from_bottom)),
            rotate: None,
            scale_x: Some(scale_x),
            scale_y: Some(scale_y),
            dpi: Some(dpi),
        },
    );
    Ok(())
}

fn parse_color(s: &str) -> Option<printpdf::Rgb> {
    let s = s.trim();
    // #rrggbb / #rgb
    if let Some(hex) = s.strip_prefix('#') {
        if hex.len() == 6 {
            let r = u8::from_str_radix(&hex[0..2], 16).ok()? as f32 / 255.0;
            let g = u8::from_str_radix(&hex[2..4], 16).ok()? as f32 / 255.0;
            let b = u8::from_str_radix(&hex[4..6], 16).ok()? as f32 / 255.0;
            return Some(printpdf::Rgb::new(r, g, b, None));
        }
        if hex.len() == 3 {
            let r = u8::from_str_radix(&hex[0..1].repeat(2), 16).ok()? as f32 / 255.0;
            let g = u8::from_str_radix(&hex[1..2].repeat(2), 16).ok()? as f32 / 255.0;
            let b = u8::from_str_radix(&hex[2..3].repeat(2), 16).ok()? as f32 / 255.0;
            return Some(printpdf::Rgb::new(r, g, b, None));
        }
    }
    // rgb(r, g, b) / rgb(r g b) — accepts 0..255 ints
    if let Some(inner) = s.strip_prefix("rgb(").and_then(|x| x.strip_suffix(')')) {
        let parts: Vec<&str> = inner.split(|c: char| c == ',' || c.is_whitespace()).filter(|s| !s.is_empty()).collect();
        if parts.len() == 3 {
            let r = parts[0].trim().parse::<f32>().ok()? / 255.0;
            let g = parts[1].trim().parse::<f32>().ok()? / 255.0;
            let b = parts[2].trim().parse::<f32>().ok()? / 255.0;
            return Some(printpdf::Rgb::new(r, g, b, None));
        }
    }
    // Named colors — common subset
    let (r, g, b) = match s.to_lowercase().as_str() {
        "black" => (0.0, 0.0, 0.0),
        "white" => (1.0, 1.0, 1.0),
        "red" => (1.0, 0.0, 0.0),
        "green" => (0.0, 0.5, 0.0),
        "blue" => (0.0, 0.0, 1.0),
        "yellow" => (1.0, 1.0, 0.0),
        "cyan" => (0.0, 1.0, 1.0),
        "magenta" => (1.0, 0.0, 1.0),
        "gray" | "grey" => (0.5, 0.5, 0.5),
        "lightgray" | "lightgrey" => (0.83, 0.83, 0.83),
        "darkgray" | "darkgrey" => (0.66, 0.66, 0.66),
        "orange" => (1.0, 0.65, 0.0),
        "purple" => (0.5, 0.0, 0.5),
        "transparent" | "none" => return None,
        _ => return None,
    };
    Some(printpdf::Rgb::new(r, g, b, None))
}

/// Parse an SVG-ish `path` attribute — emitted by the PDF importer for
/// arbitrary vector paths — into a list of printpdf points relative to the
/// shape's origin (xa, ya, h). M/L become real points; C/Q segments are
/// flattened to their endpoint (printpdf has no Bezier primitive at this
/// layer). Z is handled by the caller via the closed-path flag.
fn svg_path_to_points(d: &str, xa: f32, ya: f32, _h: f32) -> Vec<(printpdf::Point, bool)> {
    use printpdf::{Point, Mm};
    // Collect tokens up front into a Vec so we can index without fighting
    // closure lifetimes over a borrowed Split iterator.
    let toks: Vec<&str> = d
        .split(|c: char| c.is_whitespace() || c == ',')
        .filter(|s| !s.is_empty())
        .collect();
    let mut pts: Vec<(Point, bool)> = Vec::new();
    let mut i: usize = 0;
    let mut cmd: char = 'M';
    while i < toks.len() {
        let tok = toks[i];
        let first = tok.chars().next().unwrap_or(' ');
        let mut first_num: Option<f32> = None;
        if first.is_alphabetic() {
            cmd = first;
            if let Some(rest) = tok.get(1..).filter(|s| !s.is_empty()) {
                first_num = rest.parse::<f32>().ok();
            }
            i += 1;
        }
        if cmd == 'Z' || cmd == 'z' {
            // No coordinate consumption — closing handled by the polygon flag.
            continue;
        }
        let x_local = match first_num {
            Some(v) => v,
            None => {
                if i >= toks.len() { break; }
                match toks[i].parse::<f32>() { Ok(v) => { i += 1; v } Err(_) => { i += 1; continue; } }
            }
        };
        if i >= toks.len() { break; }
        let y_local = match toks[i].parse::<f32>() { Ok(v) => { i += 1; v } Err(_) => { i += 1; continue; } };
        match cmd {
            'M' | 'L' | 'm' | 'l' => {
                pts.push((Point::new(Mm(xa + x_local), Mm(ya - y_local)), false));
            }
            'C' | 'c' => {
                // x_local/y_local were cp1; advance past cp2 and take endpoint.
                if i + 4 > toks.len() { break; }
                let _cp2x = toks[i].parse::<f32>().ok(); i += 1;
                let _cp2y = toks[i].parse::<f32>().ok(); i += 1;
                let ex = toks[i].parse::<f32>().ok(); i += 1;
                let ey = toks[i].parse::<f32>().ok(); i += 1;
                if let (Some(ex), Some(ey)) = (ex, ey) {
                    pts.push((Point::new(Mm(xa + ex), Mm(ya - ey)), false));
                }
            }
            'Q' | 'q' => {
                // x_local/y_local were the control point; the next pair is the endpoint.
                if i + 2 > toks.len() { break; }
                let ex = toks[i].parse::<f32>().ok(); i += 1;
                let ey = toks[i].parse::<f32>().ok(); i += 1;
                if let (Some(ex), Some(ey)) = (ex, ey) {
                    pts.push((Point::new(Mm(xa + ex), Mm(ya - ey)), false));
                }
            }
            _ => {}
        }
    }
    pts
}

// --- Helpers ---

fn text_to_jdf(text: &str, title: &str) -> serde_json::Value {
    let content_w = 166.0f64;
    let max_y = 247.0f64;
    let body_size = 10.5f64;
    let body_lh = body_size * 0.36;

    let raw_pages: Vec<&str> = if text.contains('\u{000C}') {
        text.split('\u{000C}').collect()
    } else {
        vec![text]
    };

    let is_bullet_line = |t: &str| -> bool {
        let trimmed = t.trim_start();
        trimmed.starts_with('●') || trimmed.starts_with('•') || trimmed.starts_with('○')
            || trimmed.starts_with("- ") || trimmed.starts_with("* ") || trimmed.starts_with("· ")
    };
    let strip_bullet = |t: &str| -> String {
        t.trim_start().trim_start_matches(|c: char| "●•○·-* ".contains(c)).trim().to_string()
    };
    let is_numbered_bullet = |t: &str| -> bool {
        let trimmed = t.trim_start();
        let mut chars = trimmed.chars();
        let mut digits = 0;
        while let Some(c) = chars.next() {
            if c.is_ascii_digit() { digits += 1; continue; }
            if digits > 0 && (c == '.' || c == ')') {
                if let Some(next) = chars.next() { return next == ' '; }
                return false;
            }
            break;
        }
        false
    };
    let strip_numbered = |t: &str| -> String {
        let trimmed = t.trim_start();
        let mut idx = 0;
        for (i, c) in trimmed.char_indices() {
            if c.is_ascii_digit() { idx = i + c.len_utf8(); continue; }
            if c == '.' || c == ')' { idx = i + c.len_utf8(); break; }
            break;
        }
        trimmed[idx..].trim().to_string()
    };

    fn classify_heading(line: &str) -> Option<u8> {
        let t = line.trim();
        if t.is_empty() || t.len() > 90 { return None; }
        if t.ends_with('.') || t.ends_with(',') || t.ends_with(';') || t.ends_with(':') { return None; }
        let letters: String = t.chars().filter(|c| c.is_alphabetic()).collect();
        if letters.len() < 2 { return None; }
        let upper = letters.chars().filter(|c| c.is_uppercase()).count();
        let ratio = upper as f64 / letters.len() as f64;
        if ratio > 0.85 && t.len() <= 60 { return Some(1); }
        if t.split_whitespace().count() <= 8 && t.split_whitespace().all(|w| {
            w.chars().next().map(|c| c.is_uppercase() || !c.is_alphabetic()).unwrap_or(false)
        }) {
            if t.len() <= 60 { return Some(2); }
        }
        None
    }

    let mut pages: Vec<serde_json::Value> = Vec::new();
    let mut els: Vec<serde_json::Value> = Vec::new();
    let mut y = 5.0f64;
    let mut pn = 1usize;
    let mut first_block = true;

    let push_page = |pages: &mut Vec<serde_json::Value>, els: &mut Vec<serde_json::Value>, y: &mut f64, pn: &mut usize| {
        if !els.is_empty() {
            pages.push(serde_json::json!({"id": format!("page-{}", pn), "elements": els.clone()}));
            els.clear();
            *y = 5.0;
            *pn += 1;
        }
    };

    let estimate_height = |chars: usize| -> f64 {
        let lines = ((chars as f64) / 78.0).ceil().max(1.0);
        lines * body_lh + 2.5
    };

    for raw_page in raw_pages.iter().filter(|p| !p.trim().is_empty()) {
        let blocks: Vec<&str> = raw_page.split("\n\n").map(|b| b.trim_matches(['\n', '\r', ' '])).filter(|b| !b.is_empty()).collect();

        for block in blocks {
            let lines: Vec<&str> = block.lines().map(|l| l.trim_end()).filter(|l| !l.is_empty()).collect();
            if lines.is_empty() { continue; }

            let bullet_count = lines.iter().filter(|l| is_bullet_line(l)).count();
            let numbered_count = lines.iter().filter(|l| is_numbered_bullet(l)).count();
            let is_list = bullet_count >= lines.len().saturating_sub(0).max(1) && bullet_count >= 2;
            let is_numbered_list = !is_list && numbered_count >= 2 && numbered_count >= lines.len() / 2;

            if is_list || is_numbered_list {
                let items: Vec<serde_json::Value> = lines.iter()
                    .map(|l| if is_numbered_list { strip_numbered(l) } else { strip_bullet(l) })
                    .filter(|s| !s.is_empty())
                    .map(|s| serde_json::json!({"content": s}))
                    .collect();
                if items.is_empty() { continue; }
                let h = items.len() as f64 * body_lh * 1.4 + 4.0;
                if y + h > max_y { push_page(&mut pages, &mut els, &mut y, &mut pn); }
                els.push(serde_json::json!({
                    "type":"list",
                    "listType": if is_numbered_list { "ordered" } else { "unordered" },
                    "position": {"x": 0, "y": y},
                    "width": content_w,
                    "style": {"fontFamily":"Inter","fontSize": body_size,"lineHeight":1.6,"color":"#334155"},
                    "items": items
                }));
                y += h;
                first_block = false;
                continue;
            }

            // Try heading detection on a single-line block
            if lines.len() == 1 {
                if let Some(level) = classify_heading(lines[0]) {
                    let actual_level = if first_block { 1 } else { level + 1 };
                    let size = match actual_level { 1 => 22.0, 2 => 16.0, 3 => 13.0, _ => 11.5 };
                    let h = size * 0.5 + 6.0;
                    if y + h > max_y { push_page(&mut pages, &mut els, &mut y, &mut pn); }
                    els.push(serde_json::json!({
                        "type":"text",
                        "content": lines[0].trim(),
                        "heading": actual_level,
                        "tocEntry": lines[0].trim(),
                        "tocLevel": actual_level,
                        "position": {"x": 0, "y": y},
                        "width": content_w,
                        "style": {"fontFamily":"Inter","fontSize": size,"fontWeight":"bold","color": if actual_level <= 2 { "#0f172a" } else { "#1e293b" }}
                    }));
                    y += h;
                    first_block = false;
                    continue;
                }
            }

            // Default: paragraph (preserves line breaks within block as soft breaks → join with space)
            let content = lines.join(" ");
            let h = estimate_height(content.chars().count());
            if y + h > max_y { push_page(&mut pages, &mut els, &mut y, &mut pn); }
            els.push(serde_json::json!({
                "type":"text",
                "content": content,
                "position": {"x": 0, "y": y},
                "width": content_w,
                "style": {"fontFamily":"Inter","fontSize": body_size,"lineHeight":1.55,"color":"#334155"}
            }));
            y += h;
            first_block = false;
        }

        // Page boundary from PDF formfeed
        push_page(&mut pages, &mut els, &mut y, &mut pn);
    }

    push_page(&mut pages, &mut els, &mut y, &mut pn);
    if pages.is_empty() {
        pages.push(serde_json::json!({"id":"page-1","elements":[{"type":"text","content":"(Empty PDF — no extractable text)","position":{"x":0,"y":20},"width":166,"style":{"fontSize":11,"color":"#94a3b8","fontStyle":"italic"}}]}));
    }
    serde_json::json!({
        "$jdf":"1.0.0",
        "meta":{"title": title,"pageSize":"A4","unit":"mm","margins":{"top":25,"right":22,"bottom":25,"left":22}},
        "styles":{
            "heading1":{"fontFamily":"Inter","fontSize":22,"fontWeight":"bold","color":"#0f172a"},
            "heading2":{"fontFamily":"Inter","fontSize":16,"fontWeight":"bold","color":"#1e293b"},
            "body":{"fontFamily":"Inter","fontSize":body_size,"lineHeight":1.6,"color":"#334155"}
        },
        "pages": pages
    })
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
    let mut out = String::new();
    if let Some(c) = el.get("content").and_then(|c| c.as_str()) {
        out.push_str(c);
    }
    if let Some(runs) = el.get("runs").and_then(|r| r.as_array()) {
        for r in runs {
            if let Some(t) = r.get("text").and_then(|t| t.as_str()) { out.push_str(t); }
        }
    }
    if let Some(items) = el.get("items").and_then(|i| i.as_array()) {
        for it in items {
            if let Some(c) = it.get("content").and_then(|c| c.as_str()) {
                if !out.is_empty() { out.push(' '); }
                out.push_str(c);
            }
            // Nested list items can carry sub-items.
            if let Some(sub) = it.get("items").and_then(|i| i.as_array()) {
                for sit in sub {
                    if let Some(c) = sit.get("content").and_then(|c| c.as_str()) {
                        if !out.is_empty() { out.push(' '); }
                        out.push_str(c);
                    }
                }
            }
        }
    }
    if let Some(rows) = el.get("rows").and_then(|r| r.as_array()) {
        for row in rows.iter().filter_map(|r| r.as_array()) {
            for cell in row {
                if let Some(s) = cell.as_str() {
                    if !out.is_empty() { out.push(' '); }
                    out.push_str(s);
                } else if let Some(s) = cell.get("content").and_then(|c| c.as_str()) {
                    if !out.is_empty() { out.push(' '); }
                    out.push_str(s);
                }
            }
        }
    }
    if let Some(t) = el.get("title").and_then(|t| t.as_str()) {
        if !out.is_empty() { out.push(' '); }
        out.push_str(t);
    }
    // Recurse into collapsible.elements so search finds nested content even
    // when the section is closed in the UI. Search is cross-cutting; the
    // user's mental model is "find this text in this document," not "find
    // this text only inside currently-expanded sections."
    if let Some(children) = el.get("elements").and_then(|c| c.as_array()) {
        for child in children {
            let sub = extract_text(child);
            if !sub.is_empty() {
                if !out.is_empty() { out.push(' '); }
                out.push_str(&sub);
            }
        }
    }
    out
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
