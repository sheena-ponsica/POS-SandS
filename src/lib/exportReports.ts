import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface ExportTablePayload {
  filename: string;
  title: string;
  subtitle?: string;
  headers: string[];
  rows: Array<Array<string | number>>;
}

export function exportToExcel(payload: ExportTablePayload): void {
  const worksheetData = [payload.headers, ...payload.rows];
  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Report');
  XLSX.writeFile(workbook, `${payload.filename}.xlsx`);
}

export function exportToCsv(payload: ExportTablePayload): void {
  const escapeCell = (v: string | number) => {
    const str = String(v ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const lines = [payload.headers, ...payload.rows].map((row) => row.map(escapeCell).join(','));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${payload.filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportToPdf(payload: ExportTablePayload): void {
  const doc = new jsPDF({ orientation: payload.headers.length > 6 ? 'landscape' : 'portrait' });
  doc.setFontSize(15);
  doc.text("Sheena & Shelo's Business", 14, 16);
  doc.setFontSize(11);
  doc.text(payload.title, 14, 23);
  if (payload.subtitle) {
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(payload.subtitle, 14, 29);
  }

  autoTable(doc, {
    head: [payload.headers],
    body: payload.rows.map((r) => r.map((c) => String(c ?? ''))),
    startY: payload.subtitle ? 34 : 28,
    styles: { fontSize: 8.5, cellPadding: 2.5 },
    headStyles: { fillColor: [15, 23, 42], textColor: 255 },
  });

  doc.save(`${payload.filename}.pdf`);
}
