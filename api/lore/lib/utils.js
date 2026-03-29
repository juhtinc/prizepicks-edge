/**
 * api/lore/lib/utils.js
 * Shared utilities for Sports Lore pipeline.
 */

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

function getBatchIdForDate(date) {
  const weekNum = getISOWeek(date);
  return `${date.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function getEasternHour(date) {
  const jan = new Date(date.getFullYear(), 0, 1).getTimezoneOffset();
  const jul = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
  const isDST = date.getTimezoneOffset() < Math.max(jan, jul);
  const offset = isDST ? 4 : 5;
  return (date.getUTCHours() - offset + 24) % 24;
}

function getEasternOffset(date) {
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" });
  const parts = formatter.formatToParts(date);
  const tz = parts.find(p => p.type === "timeZoneName");
  const match = (tz?.value || "GMT-5").match(/GMT([+-]\d+)/);
  const hours = parseInt(match?.[1] || "-5");
  return `${hours < 0 ? "-" : "+"}${String(Math.abs(hours)).padStart(2, "0")}:00`;
}

module.exports = { getISOWeek, getBatchIdForDate, getEasternHour, getEasternOffset };
