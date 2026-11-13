import type { Env } from "./env";
import { RESERVED } from "./links";
import { isSlug, now, randomId } from "./util";

/**
 * Ready-made rooms: top-level folders, subfolders, and a hidden one-page placeholder in each
 * subfolder ("Pitch deck: replace this"). The founder uploads their own version over each
 * placeholder, which keeps the place and makes it visible. Generic wording only: no company,
 * person or figure from anywhere.
 *
 * Kept small on purpose (under 30 placeholders): applying a template is one request, and
 * Cloudflare's free plan limits how much one request may do.
 */

/** An item is a subfolder name, or [name, short link] when the template suggests a link for it. */
type Item = string | [name: string, slug: string];
type Section = { name: string; description: string; slug?: string; items: Item[] };
export type Template = { id: string; name: string; summary: string; sections: Section[] };

export const TEMPLATES: Template[] = [
  {
    // Follows the order of the standard venture due diligence request list, so an investor's
    // checklist maps one to one onto the folders. Bank and wire details are left out on purpose:
    // they go to an investor directly, never into a shared room.
    id: "investor",
    name: "Investor data room",
    summary: "For a fundraise: the standard due diligence checklist, section by section, with short links like /cap-table.",
    sections: [
      {
        name: "Corporate",
        slug: "corporate",
        description: "Incorporation, governance and company structure.",
        items: [["Certificate of incorporation", "certificate"], ["Bylaws", "bylaws"], ["Subsidiaries", "subsidiaries"], ["Board minutes", "board-minutes"], ["Valuation (409A)", "valuation"]],
      },
      {
        name: "Capitalization",
        slug: "capitalization",
        description: "Who owns what.",
        items: [["Cap table", "cap-table"], ["Option plan", "option-plan"]],
      },
      {
        name: "Financials",
        slug: "financials",
        description: "Results so far and the plan ahead.",
        items: [["Financial statements", "financial-statements"], ["Budget and forecast", "budget"], ["Financial model", "financial-model"]],
      },
      {
        name: "Team",
        slug: "team",
        description: "Management, employees and consultants.",
        items: [["Team biographies", "team-bios"], ["Founder stock and vesting", "vesting"], ["Confidentiality and invention assignment", "invention-assignment"], ["Organisation chart", "org-chart"]],
      },
      {
        name: "Business plan",
        slug: "business-plan",
        description: "What the company does, for whom, and against whom.",
        items: [["Pitch deck", "deck"], ["Executive summary", "summary"], ["Competitors", "competitors"], ["Key metrics", "metrics"]],
      },
      {
        name: "Financing",
        slug: "financing",
        description: "This round's terms and the investors so far.",
        items: [["Term sheet", "term-sheet"], ["Financing agreements", "financing-agreements"], ["Schedule of investors", "investor-schedule"], ["Disclosure schedule", "disclosures"], ["Use of funds", "use-of-funds"]],
      },
      {
        name: "IP",
        slug: "ip-rights", // links need 3+ characters
        description: "Intellectual property and agreements that touch it.",
        items: [["Patents and trademarks", "trademarks"], ["IP licences", "ip-licences"], ["Joint ventures and development agreements", "development-agreements"]],
      },
    ],
  },
  {
    id: "sale",
    name: "Selling the company",
    summary: "For a sale or merger: what a buyer reviews before signing.",
    sections: [
      { name: "Corporate", description: "Structure and constitutional documents.", items: ["Group structure chart", "Constitutional documents", "Board and shareholder minutes"] },
      { name: "Financial", description: "Accounts and forecasts.", items: ["Audited accounts", "Management accounts", "Forecasts"] },
      { name: "Tax", description: "Returns and correspondence.", items: ["Tax returns", "Tax correspondence"] },
      { name: "Commercial", description: "Customers and suppliers.", items: ["Customer contracts", "Supplier contracts"] },
      { name: "People", description: "Employees, terms and benefits.", items: ["Employee list", "Employment terms and policies", "Pensions and benefits"] },
      { name: "IP and technology", description: "What the company owns and licenses.", items: ["Registered IP", "Software and licences"] },
      { name: "Property and assets", description: "Premises and equipment.", items: ["Leases", "Asset register"] },
      { name: "Legal and compliance", description: "Claims, permits and cover.", items: ["Litigation", "Licences and permits", "Insurance"] },
    ],
  },
  {
    id: "board",
    name: "Board portal",
    summary: "For a board: meeting packs, minutes and governance papers.",
    sections: [
      { name: "Board meetings", description: "Packs for each meeting.", items: ["Next meeting pack", "Past meeting packs"] },
      { name: "Minutes and resolutions", description: "Decisions on record.", items: ["Minutes", "Written resolutions"] },
      { name: "Committees", description: "Committee papers.", items: ["Audit committee", "Remuneration committee"] },
      { name: "Governance", description: "How the board works.", items: ["Board policies", "Register of interests"] },
      { name: "Reports", description: "Regular updates to the board.", items: ["Management reports", "Financial reports"] },
    ],
  },
  {
    id: "client",
    name: "Client or partner portal",
    summary: "For a client or partner: proposals, contracts and deliverables in one place.",
    sections: [
      { name: "Proposals", description: "What we proposed.", items: ["Proposal", "Pricing"] },
      { name: "Contracts", description: "What we agreed.", items: ["Agreement", "Statements of work"] },
      { name: "Deliverables", description: "What we delivered.", items: ["Current deliverables", "Archive"] },
      { name: "Reports", description: "Progress and results.", items: ["Progress reports"] },
      { name: "Billing", description: "Invoices and statements.", items: ["Invoices"] },
    ],
  },
];

export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id) ?? null;

/** A one-page PDF with a title and a few lines of text. Hand-written so making ~25 of them costs almost nothing. */
export function placeholderPdf(title: string, lines: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/[^\x20-\x7e]/g, "?").replace(/[\\()]/g, (ch) => `\\${ch}`);
  let y = 700;
  const text = [`BT /F1 22 Tf 72 ${y} Td (${esc(title)}) Tj ET`];
  for (const line of lines) {
    y -= line ? 26 : 14;
    if (line) text.push(`BT /F1 12 Tf 72 ${y} Td (${esc(line)}) Tj ET`);
  }
  const stream = text.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

/**
 * Adds a template's folders, subfolders and placeholders after whatever the room already has.
 * Folders are stamped (PDFs carry the viewer's email), placeholders are hidden and marked so
 * they can never be made visible as they are.
 */
export async function applyTemplate(env: Env, template: Template): Promise<{ folders: number; placeholders: number }> {
  const t = now();
  const max = await env.DB.prepare("SELECT COALESCE(MAX(position), 0) AS p FROM folders").first<{ p: number }>();
  let position = max?.p ?? 0;
  // Suggested links are only a convenience: one the room already uses (or a second copy of the
  // template) is skipped, never an error. Links and ids share one set of names.
  const used = await env.DB.prepare(
    `SELECT slug AS s FROM files WHERE slug IS NOT NULL UNION SELECT slug FROM folders WHERE slug IS NOT NULL
     UNION SELECT id FROM files UNION SELECT id FROM folders`,
  ).all<{ s: string }>();
  const taken = new Set(used.results.map((r) => r.s));
  const claim = (slug: string | undefined): string | null => {
    if (!slug || RESERVED.has(slug) || !isSlug(slug) || taken.has(slug)) return null;
    taken.add(slug);
    return slug;
  };
  const statements: D1PreparedStatement[] = [];
  const puts: Promise<unknown>[] = [];
  let folders = 0;
  let placeholders = 0;
  const addFolder = (name: string, description: string, parentId: string | null, slug: string | null = null) => {
    const id = randomId();
    position += 10;
    folders++;
    statements.push(
      env.DB.prepare("INSERT INTO folders (id, name, description, position, watermark, created_at, parent_id, slug) VALUES (?, ?, ?, ?, 1, ?, ?, ?)").bind(
        id,
        name,
        description,
        position,
        t,
        parentId,
        slug,
      ),
    );
    return id;
  };
  for (const [i, section] of template.sections.entries()) {
    const topId = addFolder(`${i + 1}. ${section.name}`, section.description, null, claim(section.slug));
    for (const entry of section.items) {
      const [item, itemSlug] = typeof entry === "string" ? [entry, undefined] : entry;
      // The item's link goes on its file, so it keeps working when the founder uploads over the
      // placeholder (a replaced file keeps its link) and opens the document itself.
      const fileSlug = claim(itemSlug);
      const subId = addFolder(item, "", topId);
      const fileId = randomId();
      const key = `files/${fileId}`;
      const pdf = placeholderPdf(`${item}: placeholder`, [
        "Replace this page with your own document.",
        "",
        "In the admin view, find this file and click 'Upload your version'.",
        "Your file takes its place and becomes visible to investors who",
        "have access to this folder. Investors never see this placeholder.",
      ]);
      puts.push(env.FILES.put(key, pdf, { httpMetadata: { contentType: "application/pdf" } }));
      statements.push(
        env.DB.prepare(
          `INSERT INTO files (id, folder_id, name, r2_key, content_type, size, published, allow_download, orientation, uploaded_at, updated_at, placeholder, slug)
           VALUES (?, ?, ?, ?, 'application/pdf', ?, 0, 0, 'portrait', ?, ?, 1, ?)`,
        ).bind(fileId, subId, `${item}.pdf`, key, pdf.byteLength, t, t, fileSlug),
      );
      placeholders++;
    }
  }
  await Promise.all(puts);
  await env.DB.batch(statements);
  return { folders, placeholders };
}
