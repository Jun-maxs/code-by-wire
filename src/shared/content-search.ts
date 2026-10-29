/** A session whose transcript mentions the searched text, with a short excerpt around the match. */
export interface ContentHit {
  id: string;
  snippet: string;
}

export interface ContentSearchResult {
  hits: ContentHit[];
  /** The index is still catching up, so older sessions may be missing from `hits`. */
  indexing: boolean;
}
