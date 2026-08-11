export function formatCurrencyPaise(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}

export function formatTimestamp(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
}

export function formatBoolean(value: boolean, trueText = "Yes", falseText = "No"): string {
  return value ? trueText : falseText;
}
