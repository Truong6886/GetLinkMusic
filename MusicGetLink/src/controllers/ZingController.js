const { ZingMp3 } = require("zingmp3-api-full");

class ZingController {
    constructor() {
        this.getArtistSongs = this.getArtistSongs.bind(this);
    }

    getAlbumType(title = "", trackCount = 0) {
        const lowerTitle = title.toLowerCase();

        // Ưu tiên phân loại theo tiêu đề bài hát
        if (lowerTitle.includes("(single)")) return "Single";
        if (lowerTitle.includes("(ep)")) return "EP";

        // Nếu không có thông tin trong tiêu đề, kiểm tra số lượng bài hát
        if (trackCount >= 1 && trackCount <= 3) return "Single";
        if (trackCount >= 3 && trackCount < 6) return "EP";
        return "Regular";
    }

    async getArtistSongs(req, res) {
        const artistAlias = req.query.name;
        if (!artistAlias) {
            return res.status(400).json({ error: "Missing artist alias" });
        }

        try {
            const allSongs = await this.fetchAllSongs(artistAlias);
            res.json({ artist: artistAlias, total: allSongs.length, songs: allSongs });
        } catch (error) {
            console.error("Error in getArtistSongs:", error.message);
            res.status(500).json({ error: "Internal Server Error" });
        }
    }

    async fetchAllSongs(artistAlias, page = 1, allSongs = new Map()) {
        try {
            const artistData = await ZingMp3.getArtist(artistAlias, { page });
            if (!artistData?.data?.sections) return Array.from(allSongs.values());

            const mainArtist = artistData.data.alias.toLowerCase();

            for (const section of artistData.data.sections) {
                if (["song", "single", "top-songs", "all"].includes(section.sectionType)) {
                    await this.processSongs(section.items, allSongs, mainArtist);
                }
                if (["album", "playlist"].includes(section.sectionType)) {
                    await this.processPlaylists(section.items, allSongs, mainArtist);
                }
            }

            return artistData.data.hasMore
                ? this.fetchAllSongs(artistAlias, page + 1, allSongs)
                : Array.from(allSongs.values());
        } catch (error) {
            console.error("Error in fetchAllSongs:", error.message);
            return Array.from(allSongs.values());
        }
    }

    async processSongs(songs, allSongs, mainArtist) {
        for (const song of songs) {
            if (!song.title || !song.artistsNames || !song.encodeId) continue;

            const songKey = song.encodeId;
            if (allSongs.has(songKey)) continue;

            let songData = {
                title: song.title,
                artists: song.artistsNames,
                featuredArtists: song.artists?.map(a => a.name).join(", ") || null,
                album: song.album?.title || song.title,
                albumId: song.album?.encodeId || null, // Thêm album_id ở đây
                albumType: "Unknown", // Sử dụng loại "Unknown" nếu không có dữ liệu albumType
                thumbnail: song.thumbnail,
                link: song.link ? `https://zingmp3.vn${song.link}` : null,
                albumLink: song.album?.link ? `https://zingmp3.vn${song.album.link}` : null,
                releaseDate: null,
                providedBy: null,
                albumOwner: null,
                tracklist: []
            };

            if (song.album?.encodeId) {
                try {
                    const albumData = await ZingMp3.getDetailPlaylist(song.album.encodeId);
                    if (albumData?.data) {
                        this.extractAlbumInfo(albumData, songData, mainArtist, song.encodeId);
                    }
                } catch (error) {
                    console.error("Error fetching album details:", error.message);
                }
            } else if (song.album?.link) {
                // Nếu không có encodeId nhưng có albumLink, ta sẽ lấy số lượng bài hát từ link
                try {
                    const albumData = await this.fetchAlbumDetailsFromLink(song.album.link);
                    if (albumData?.data) {
                        this.extractAlbumInfo(albumData, songData, mainArtist, song.encodeId);
                    }
                } catch (error) {
                    console.error("Error fetching album details from link:", error.message);
                }
            }

            // Kiểm tra lại albumType nếu cần
            if (songData.albumType === "Unknown" && song.album?.trackCount != null) {
                songData.albumType = this.getAlbumType(song.album.title, song.album.trackCount);
            }

            // Nếu không có albumType thì gán là "Single"
            if (songData.albumType === "Unknown") {
                songData.albumType = "Single";
            }

            allSongs.set(songKey, songData);
        }
    }

    async fetchAlbumDetailsFromLink(albumLink) {
        try {
            const response = await fetch(albumLink); // Gửi yêu cầu HTTP để lấy trang album
            const html = await response.text();
            const trackCountMatch = html.match(/"songCount":(\d+)/); // Lấy số lượng bài hát từ HTML của trang album

            const trackCount = trackCountMatch ? parseInt(trackCountMatch[1]) : 0;
            return {
                data: {
                    song: {
                        items: Array.from({ length: trackCount }, (_, i) => ({ title: `Track ${i + 1}` }))
                    }
                }
            };
        } catch (error) {
            console.error("Error fetching album details from link:", error);
            return null;
        }
    }

    async processPlaylists(playlists, allSongs, mainArtist) {
        const playlistPromises = playlists.map(async (playlist) => {
            if (!playlist.encodeId) return;

            try {
                const playlistData = await ZingMp3.getDetailPlaylist(playlist.encodeId);
                if (!playlistData?.data) return;

                const albumName = playlistData.data.title;
                const albumLink = `https://zingmp3.vn${playlistData.data.link}`;
                const tracks = playlistData.data.song?.items || [];

                const trackCount = tracks.length;
                const albumType = this.getAlbumType(albumName, trackCount);

                for (const track of tracks) {
                    if (!track.title || !track.artistsNames || !track.encodeId) continue;

                    const trackKey = track.encodeId;
                    if (allSongs.has(trackKey)) continue;

                    const isMainArtist =
                        track.artistsNames.toLowerCase().includes(mainArtist) ||
                        track.artists?.some(artist => artist.alias?.toLowerCase() === mainArtist);

                    if (isMainArtist) {
                        const trackData = {
                            title: track.title,
                            artists: track.artistsNames,
                            featuredArtists: track.artists?.map(a => a.name).join(", ") || null,
                            album: albumName,
                            albumId: playlistData.data.encodeId, // Thêm album_id ở đây
                            albumType: albumType,
                            thumbnail: track.thumbnail,
                            link: track.link ? `https://zingmp3.vn${track.link}` : null,
                            albumLink: albumLink,
                            releaseDate: playlistData.data.releaseDate || null,
                            providedBy: playlistData.data.distributor || null,
                            albumOwner: playlistData.data.artistsNames || null,
                            tracklist: tracks.map(t => ({
                                title: t.title,
                                artists: t.artistsNames,
                                link: t.link ? `https://zingmp3.vn${t.link}` : null
                            }))
                        };

                        allSongs.set(trackKey, trackData);
                    }
                }
            } catch (error) {
                console.error("Error fetching playlist details:", error.message);
            }
        });

        await Promise.all(playlistPromises);
    }

    extractAlbumInfo(albumData, songData, mainArtist, songId) {
        if (!albumData?.data) return;

        const title = albumData.data.title || "";
        const tracks = albumData.data.song?.items || [];
        const trackCount = tracks.length;

        songData.releaseDate = albumData.data.releaseDate || null;
        songData.providedBy = albumData.data.distributor || null;
        songData.albumOwner = albumData.data.artistsNames || null;
        songData.albumId = albumData.data.encodeId || null; // Lấy albumId từ encodeId
        songData.albumType = this.getAlbumType(title, trackCount); // Cập nhật albumType từ số lượng bài hát

        songData.tracklist = tracks
            .filter(track => track.artistsNames.toLowerCase().includes(mainArtist))
            .map(track => ({
                title: track.title,
                artists: track.artistsNames,
                link: track.link ? `https://zingmp3.vn${track.link}` : null
            }));

        const matchingTrack = tracks.find(track => track.encodeId === songId);
        if (matchingTrack && !songData.link) {
            songData.link = matchingTrack.link ? `https://zingmp3.vn${matchingTrack.link}` : null;
        }
    }
}

module.exports = new ZingController();
