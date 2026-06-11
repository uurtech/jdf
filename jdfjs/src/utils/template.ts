export interface TemplateVars {
  pageNumber: number;
  totalPages: number;
  title: string;
  author: string;
}

export function resolveTemplate(text: string, vars: TemplateVars): string {
  return text
    .replace(/\{\{pageNumber\}\}/g, String(vars.pageNumber))
    .replace(/\{\{totalPages\}\}/g, String(vars.totalPages))
    .replace(/\{\{title\}\}/g, vars.title)
    .replace(/\{\{author\}\}/g, vars.author);
}
