/**
 * Documentation site — shared sidebar inject + active link highlighting.
 *
 * Each doc page contains:
 *   <aside class="docs-sidebar" data-base="../"></aside>
 * On load this script reads `data-base` (relative path back to /docs/), renders
 * the sidebar markup, and marks the active link.
 */

const SIDEBAR = (base) => `
  <h4>Get started</h4>
  <ul>
    <li><a href="${base}index.html">Introduction</a></li>
    <li><a href="${base}getting-started.html">Getting started</a></li>
    <li><a href="${base}why-ai.html">Why AI-friendly</a></li>
  </ul>

  <h4>Web embed — jdf.js</h4>
  <ul>
    <li><a href="${base}embed/index.html">&lt;jdf&gt; tag</a></li>
    <li><a href="${base}embed/examples.html">Live examples</a></li>
    <li><a href="${base}embed/api.html">API reference</a></li>
    <li><a href="${base}embed/frameworks.html">React · Vue · Svelte</a></li>
  </ul>

  <h4>Format</h4>
  <ul>
    <li><a href="${base}format/index.html">Format overview</a></li>
    <li><a href="${base}format/elements.html">Element reference</a></li>
  </ul>

  <h4>Tools</h4>
  <ul>
    <li><a href="${base}desktop.html">Desktop Reader</a></li>
    <li><a href="${base}cli.html">CLI</a></li>
  </ul>

  <h4>Project</h4>
  <ul>
    <li><a href="https://github.com/uurtech/jdf" target="_blank" rel="noopener">GitHub ↗</a></li>
    <li><a href="https://github.com/uurtech/jdf/blob/master/CHANGELOG.md" target="_blank" rel="noopener">Changelog ↗</a></li>
  </ul>
`;

document.addEventListener("DOMContentLoaded", () => {
  const aside = document.querySelector(".docs-sidebar");
  if (!aside) return;
  const base = aside.getAttribute("data-base") || "./";
  aside.innerHTML = SIDEBAR(base);

  // Highlight active link
  const here = location.pathname.replace(/\/$/, "");
  aside.querySelectorAll("a").forEach((a) => {
    const href = a.getAttribute("href");
    if (!href || href.startsWith("http")) return;
    const url = new URL(href, location.href);
    const path = url.pathname.replace(/\/$/, "");
    if (path === here || (here.endsWith("/") && path === here + "index.html")) {
      a.classList.add("active");
    }
  });
});
