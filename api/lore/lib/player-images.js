/**
 * api/lore/lib/player-images.js
 * Fetches player portrait images from Wikipedia and ESPN.
 *
 * Wikipedia images are typically public domain or Creative Commons,
 * making them safer for YouTube content than random Google Images.
 *
 * Fallback chain: Wikipedia → ESPN headshot → YouTube thumbnail
 */

const axios = require("axios");

/**
 * Search Wikipedia for a player's page and extract the main image.
 * Uses the Wikipedia API (no key required, free, public).
 *
 * @param {string} playerName - e.g., "Connie Hawkins"
 * @returns {string|null} URL to the player's Wikipedia image, or null
 */
async function getWikipediaImage(playerName) {
  try {
    // Step 1: Search for the player's Wikipedia page
    const searchResp = await axios.get("https://en.wikipedia.org/w/api.php", {
      params: {
        action: "query",
        list: "search",
        srsearch: `${playerName} basketball player`,
        srlimit: 3,
        format: "json",
        origin: "*",
      },
    });

    const results = searchResp.data?.query?.search || [];
    if (!results.length) return null;

    // Find the most relevant result (prioritize exact name match)
    const page = results.find(r =>
      r.title.toLowerCase().includes(playerName.toLowerCase().split(" ")[1] || playerName.toLowerCase())
    ) || results[0];

    const pageTitle = page.title;

    // Step 2: Get the page's main image (thumbnail)
    const imageResp = await axios.get("https://en.wikipedia.org/w/api.php", {
      params: {
        action: "query",
        titles: pageTitle,
        prop: "pageimages",
        piprop: "original",
        format: "json",
        origin: "*",
      },
    });

    const pages = imageResp.data?.query?.pages || {};
    const pageData = Object.values(pages)[0];
    const imageUrl = pageData?.original?.source;

    if (imageUrl) return imageUrl;

    // Step 3: Fallback — try to get any image from the page
    const imagesResp = await axios.get("https://en.wikipedia.org/w/api.php", {
      params: {
        action: "query",
        titles: pageTitle,
        prop: "images",
        imlimit: 10,
        format: "json",
        origin: "*",
      },
    });

    const imgPages = imagesResp.data?.query?.pages || {};
    const imgList = Object.values(imgPages)[0]?.images || [];

    // Filter for likely portrait images (skip logos, icons, flags)
    const portrait = imgList.find(img => {
      const name = img.title.toLowerCase();
      return (name.includes(playerName.toLowerCase().split(" ")[1]) || name.includes("portrait") || name.includes("headshot"))
        && !name.includes("logo") && !name.includes("flag") && !name.includes("icon") && !name.includes(".svg");
    });

    if (portrait) {
      // Get the actual file URL
      const fileResp = await axios.get("https://en.wikipedia.org/w/api.php", {
        params: {
          action: "query",
          titles: portrait.title,
          prop: "imageinfo",
          iiprop: "url",
          format: "json",
          origin: "*",
        },
      });
      const filePages = fileResp.data?.query?.pages || {};
      return Object.values(filePages)[0]?.imageinfo?.[0]?.url || null;
    }

    return null;
  } catch (e) {
    console.error(`[player-images] Wikipedia failed for ${playerName}:`, e.message);
    return null;
  }
}

/**
 * Get an ESPN headshot for a player.
 * ESPN's CDN hosts headshots at a predictable URL pattern if you know the player ID.
 * This searches ESPN's public API to find the player first.
 *
 * @param {string} playerName - e.g., "LeBron James"
 * @param {string} sport - e.g., "NBA", "NFL"
 * @returns {string|null} URL to ESPN headshot
 */
async function getESPNHeadshot(playerName, sport) {
  const sportMap = {
    NBA: "basketball/nba",
    NFL: "football/nfl",
    MLB: "baseball/mlb",
    NHL: "hockey/nhl",
    Soccer: "soccer",
  };
  const espnSport = sportMap[sport] || "basketball/nba";

  try {
    const resp = await axios.get(
      `https://site.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(playerName)}&limit=5&type=player`,
    );

    const results = resp.data?.items || resp.data?.results || [];
    if (!results.length) return null;

    // ESPN player pages have headshots at a standard CDN path
    const player = results[0];
    const playerId = player.id || player.uid?.split(":")?.[2];

    if (playerId) {
      // ESPN CDN headshot pattern
      return `https://a.espncdn.com/combiner/i?img=/i/headshots/${espnSport}/players/full/${playerId}.png&w=350&h=254`;
    }

    return null;
  } catch (e) {
    console.error(`[player-images] ESPN failed for ${playerName}:`, e.message);
    return null;
  }
}

/**
 * Get the best available player image using the fallback chain:
 * Wikipedia → ESPN → null
 *
 * @param {string} playerName
 * @param {string} sport
 * @returns {object} { url, source } or { url: null, source: "none" }
 */
async function getPlayerImage(playerName, sport) {
  // Try Wikipedia first (best for historical/retired players)
  const wikiUrl = await getWikipediaImage(playerName);
  if (wikiUrl) return { url: wikiUrl, source: "wikipedia" };

  // Try ESPN (best for active players)
  const espnUrl = await getESPNHeadshot(playerName, sport);
  if (espnUrl) return { url: espnUrl, source: "espn" };

  return { url: null, source: "none" };
}

module.exports = { getWikipediaImage, getESPNHeadshot, getPlayerImage };
