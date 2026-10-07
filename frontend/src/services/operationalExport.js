// CSV cells are quoted and spreadsheet formula prefixes are neutralized.
export function operationalCsv(columns, rows) {
  const cell = value => {
    const text = String(value ?? "");
    return `"${(/^[\s]*[=+@-]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`;
  };
  return [columns, ...rows].map(row => row.map(cell).join(",")).join("\r\n");
}

export function downloadOperationalCsv(filename, columns, rows) {
  const url = URL.createObjectURL(new Blob(["\uFEFF", operationalCsv(columns, rows)], { type: "text/csv;charset=utf-8;" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
