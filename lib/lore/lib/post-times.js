/**
 * api/lore/lib/post-times.js
 * Sport-based optimal posting times for YouTube Shorts.
 *
 * With 2 videos per day, each day has a morning and evening slot.
 * Morning catches the commute/lunch crowd, evening catches prime time.
 */

const POST_TIMES = {
  NBA:     { morning: "11:00", evening: "18:00" },  // Pre-game buzz evening
  MLB:     { morning: "11:00", evening: "15:00" },  // Afternoon games
  NFL:     { morning: "09:00", evening: "18:00" },  // Sunday morning + evening
  NHL:     { morning: "11:00", evening: "17:00" },  // Pre-game evening
  Soccer:  { morning: "08:00", evening: "12:00" },  // International audience
  Boxing:  { morning: "12:00", evening: "20:00" },  // Fight night energy
  Tennis:  { morning: "10:00", evening: "14:00" },  // Match times
  default: { morning: "10:00", evening: "19:00" },  // General sports
};

/**
 * Get optimal post time for a sport.
 * @param {string} sport - Sport name
 * @param {string} slot - "morning" or "evening"
 * @returns {string} Time in HH:MM format
 */
function getOptimalPostTime(sport, slot = "evening") {
  const times = POST_TIMES[sport] || POST_TIMES.default;
  return times[slot] || times.evening;
}

module.exports = { POST_TIMES, getOptimalPostTime };
