/**
 * api/lore/lib/post-times.js
 * Sport-based optimal posting times for YouTube Shorts.
 */

const POST_TIMES = {
  NBA:     "18:00",
  MLB:     "15:00",
  NFL:     "11:00",
  NHL:     "17:00",
  Soccer:  "12:00",
  Boxing:  "20:00",
  Tennis:  "14:00",
  default: "19:00",
};

function getOptimalPostTime(sport) {
  return POST_TIMES[sport] || POST_TIMES.default;
}

module.exports = { POST_TIMES, getOptimalPostTime };
