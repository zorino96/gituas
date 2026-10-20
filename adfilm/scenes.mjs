// Which scenes of a job are left once its files have been fetched (used by worker.mjs fetch; kept apart so that
// the rule can be tested without a network).
//
// A product scene needs its photo and a footage scene its clip: when a file could not be fetched the scene is
// dropped, as it always was. A story is different: every beat carries a sentence of the plot, so a beat is never
// dropped for its backdrop. A picture or a clip that could not be fetched leaves the beat on the look's own
// background, and that includes a footage scene of a story (it becomes an ordinary beat, same words, same voice).
//
// `photos` keeps the places of the photos (a failed one is null), so a photo index stays as it was; the clips were
// compacted when they were fetched, so `clipIndex` maps an old clip index to its new place.

/**
 * @param {Array<Record<string, any>>} scenes the scenes of the job
 * @param {{ photos: Array<string | null>, clipIndex: Map<number, number>, story?: boolean }} fetched
 * @returns {Array<Record<string, any>>}
 */
export function settleScenes(scenes, { photos, clipIndex, story = false }) {
  const kept = [];
  for (const s of scenes) {
    if (s.type === "product") {
      if (Number.isInteger(s.photo) && photos[s.photo]) kept.push(s);
    } else if (s.type === "footage") {
      if (Number.isInteger(s.clip) && clipIndex.has(s.clip)) kept.push({ ...s, clip: clipIndex.get(s.clip) });
      else if (story) kept.push({ ...s, type: "story", photo: null, clip: null });
    } else if (s.type === "story") {
      kept.push({
        ...s,
        photo: Number.isInteger(s.photo) && photos[s.photo] ? s.photo : null,
        clip: Number.isInteger(s.clip) && clipIndex.has(s.clip) ? clipIndex.get(s.clip) : null,
      });
    } else {
      kept.push(s);
    }
  }
  return kept;
}
