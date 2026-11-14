import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { renderSheet } from "../src/render";

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';

/** Builds a small .xlsx by hand so the tests need no binary fixtures. */
function xlsx(opts: { sheet: string; styles?: string; shared?: string[]; hiddenSecond?: boolean }): ArrayBuffer {
  const styles =
    opts.styles ??
    `<styleSheet ${NS}>
  <numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0"/></numFmts>
  <fonts count="3">
    <font><sz val="11"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/></font>
    <font><i/><sz val="9"/><color rgb="FF555555"/></font>
  </fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1F2A44"/></patternFill></fill></fills>
  <borders count="1"><border/></borders>
  <cellXfs count="5">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0"/>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="0"/>
    <xf numFmtId="10" fontId="0" fillId="0" borderId="0"/>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0"><alignment wrapText="1"/></xf>
  </cellXfs>
</styleSheet>`;
  const shared = (opts.shared ?? []).map((t) => `<si><t>${t}</t></si>`).join("");
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`),
    "xl/workbook.xml": strToU8(
      `<workbook ${NS} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>
        <sheet name="Cap Table" sheetId="1" r:id="rId1"/>
        ${opts.hiddenSecond ? '<sheet name="Secret" sheetId="2" state="hidden" r:id="rId2"/>' : ""}
      </sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Target="worksheets/sheet1.xml"/>
        <Relationship Id="rId2" Target="worksheets/sheet2.xml"/>
      </Relationships>`,
    ),
    "xl/styles.xml": strToU8(styles),
    "xl/sharedStrings.xml": strToU8(`<sst ${NS}>${shared}</sst>`),
    "xl/worksheets/sheet1.xml": strToU8(opts.sheet),
    "xl/worksheets/sheet2.xml": strToU8(`<worksheet ${NS}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>TOP SECRET</t></is></c></row></sheetData></worksheet>`),
  };
  const z = zipSync(files);
  return z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength) as ArrayBuffer;
}

const SHEET = `<worksheet ${NS}>
  <sheetViews><sheetView showGridLines="0"/></sheetViews>
  <cols><col min="1" max="1" width="30" customWidth="1"/><col min="2" max="3" width="16" customWidth="1"/></cols>
  <sheetData>
    <row r="1"><c r="A1" s="1" t="s"><v>0</v></c><c r="B1" s="1"/><c r="C1" s="1"/></row>
    <row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" s="2"><v>105000</v></c><c r="C2" s="3"><v>0.0336</v></c></row>
    <row r="3"><c r="A3" s="4" t="s"><v>2</v></c></row>
  </sheetData>
  <mergeCells count="1"><mergeCell ref="A3:C3"/></mergeCells>
</worksheet>`;

describe("formatted Excel preview", () => {
  it("keeps widths, fills, number formats, merges and text colours", () => {
    const html = renderSheet(xlsx({ sheet: SHEET, shared: ["Acme, Inc.", "Friends &amp; Family", "A long note"] }), false);
    expect(html).toContain('class="xs"');
    expect(html).toMatch(/<col style="width:48\.\d+%">/); // 30 of 62 characters wide
    expect(html).toContain("calc((100vw - 24px)"); // scales down on narrow screens
    expect(html).toContain("background:#1F2A44");
    expect(html).toContain("color:#FFFFFF");
    expect(html).toContain("font-weight:700");
    expect(html).toContain(">$105,000<");
    expect(html).toContain(">3.36%<");
    expect(html).toContain("Friends &amp; Family");
    expect(html).toContain('colspan="3"'); // the merge
    expect(html).not.toContain("<thead>"); // no forced header row
    expect(html).not.toContain(">Secret<");
  });

  it("lets a long title spill over empty cells, like Excel", () => {
    const sheet = `<worksheet ${NS}><cols><col min="1" max="1" width="8"/></cols><sheetData>
      <row r="1"><c r="A1" t="inlineStr"><is><t>Acme, Inc. Capitalization Table</t></is></c></row>
      <row r="2"><c r="A2" t="inlineStr"><is><t>x</t></is></c><c r="B2" t="inlineStr"><is><t>y</t></is></c></row>
    </sheetData></worksheet>`;
    const html = renderSheet(xlsx({ sheet }), false);
    expect(html).toMatch(/colspan="\d+"[^>]*>Acme, Inc\. Capitalization Table/);
  });

  it("skips hidden sheets", () => {
    const html = renderSheet(xlsx({ sheet: SHEET, shared: ["a", "b", "c"], hiddenSecond: true }), false);
    expect(html).not.toContain("TOP SECRET");
    expect(html).not.toContain("Secret");
  });

  it("escapes cell text and never lets a file inject markup or CSS", () => {
    const hostile = `<worksheet ${NS}><sheetData><row r="1">
      <c r="A1" s="1" t="inlineStr"><is><t>&lt;img src=x onerror=alert(1)&gt;</t></is></c></row></sheetData></worksheet>`;
    const styles = `<styleSheet ${NS}><fonts count="1"><font><color rgb="FF000000;background:url(//evil)"/></font></fonts>
      <fills count="1"><fill><patternFill patternType="solid"><fgColor rgb="red;x"/></patternFill></fill></fills>
      <borders count="1"><border/></borders><cellXfs count="2"><xf/><xf fontId="0" fillId="0" borderId="0"/></cellXfs></styleSheet>`;
    const html = renderSheet(xlsx({ sheet: hostile, styles }), false);
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("evil");
  });

  it("falls back to the plain table when the file is not a readable xlsx", () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Name", "Amount"], ["A", 1]]), "Model");
    const bytes = new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }));
    expect(renderSheet(bytes.buffer as ArrayBuffer, false)).toContain("Name"); // SheetJS output has no styles part, so it still renders
    expect(renderSheet(new TextEncoder().encode("not a zip").buffer as ArrayBuffer, false)).toContain("<thead>"); // plain fallback
    expect(renderSheet(new TextEncoder().encode("a,b\n1,2").buffer as ArrayBuffer, true)).toContain("<thead>"); // CSV unchanged
  });
});
