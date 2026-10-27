// 游客模式：iTunes Search API（公开、免鉴权、CORS 全开）搜索全目录
// 搜索到的歌可以“加入 iPod”：追加进游客数据集的 songs/artists/「搜索收藏」歌单

export async function searchItunes(term, { country = "CN", limit = 30 } = {}) {
  const url =
    `https://itunes.apple.com/search?term=${encodeURIComponent(term)}` +
    `&media=music&entity=song&limit=${limit}&country=${country}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`搜索失败：HTTP ${res.status}`);
  const data = await res.json();
  return (data.results || [])
    .filter((r) => r.trackId && r.trackName && r.previewUrl)
    .map((r) => ({
      itunesId: String(r.trackId),
      name: r.trackName,
      artistName: r.artistName || "Unknown Artist",
      albumName: r.collectionName || "",
      previewUrl: r.previewUrl,
      url: r.trackViewUrl || null,
      artwork: r.artworkUrl100 || null
    }));
}

export const SEARCH_PLAYLIST_ID = "pl-search-picks";

export function resultToSong(r) {
  const id = "itunes-" + r.itunesId;
  return {
    id,
    name: r.name,
    artistName: r.artistName,
    albumName: r.albumName,
    previewUrl: r.previewUrl,
    playParams: { id, kind: "song" },
    url: r.url
  };
}

// 把搜索结果并入游客数据集（原地修改，返回是否发生变化）
export function addSongsToGuestDataset(dataset, results) {
  let changed = false;
  const songIds = new Set(dataset.songs.map((s) => s.id));
  const artistMap = new Map(dataset.artists.map((a) => [a.name, a]));
  let searchPlaylist = dataset.playlists.find((p) => p.id === SEARCH_PLAYLIST_ID);
  if (!searchPlaylist) {
    searchPlaylist = { id: SEARCH_PLAYLIST_ID, name: "Search Picks", songIds: [] };
    dataset.playlists.push(searchPlaylist);
  }

  for (const r of results) {
    const song = resultToSong(r);
    if (songIds.has(song.id)) continue;
    songIds.add(song.id);
    dataset.songs.push(song);
    if (!artistMap.has(song.artistName)) {
      const artist = { id: "ar-itunes-" + r.itunesId, name: song.artistName, songIds: [] };
      artistMap.set(song.artistName, artist);
      dataset.artists.push(artist);
    }
    artistMap.get(song.artistName).songIds.push(song.id);
    searchPlaylist.songIds.push(song.id);
    changed = true;
  }

  // 歌曲菜单按名称排序（与 Apple 原版数据一致的字序体验）
  if (changed) {
    const collator = new Intl.Collator("zh-Hans-CN", { numeric: true });
    dataset.songs.sort((a, b) => collator.compare(a.name, b.name));
  }
  return changed;
}
