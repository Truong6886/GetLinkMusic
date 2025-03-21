const { ZingMp3 } = require("zingmp3-api-full");

class ZingController {
    constructor() {
        this.getArtistSongs = this.getArtistSongs.bind(this);
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

            const songKey = `${song.encodeId}`;
            if (allSongs.has(songKey)) continue;

            let songData = {
                title: song.title,
                artists: song.artistsNames,
                featuredArtists: song.artists?.map(a => a.name).join(", ") || null,
                album: song.album?.title || song.title,
                thumbnail: song.thumbnail,
                link: song.link ? `https://zingmp3.vn${song.link}` : null, // ƯU TIÊN link bài hát
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
            }

            allSongs.set(songKey, songData);
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
    
                for (const track of playlistData.data.song.items) {
                    if (!track.title || !track.artistsNames || !track.encodeId) continue;
    
                    const trackKey = `${track.encodeId}`;
                    if (allSongs.has(trackKey)) continue;
    
                    if (track.artistsNames.toLowerCase().includes(mainArtist) || 
                        track.artists?.some(artist => artist.alias.toLowerCase() === mainArtist)) {
                        
                        let trackData = {
                            title: track.title,
                            artists: track.artistsNames,
                            featuredArtists: track.artists?.map(a => a.name).join(", ") || null,
                            album: albumName,
                            thumbnail: track.thumbnail,
                            link: track.link ? `https://zingmp3.vn${track.link}` : null, 
                            albumLink: albumLink,
                            releaseDate: playlistData.data.releaseDate || null,
                            providedBy: playlistData.data.distributor || null,
                            albumOwner: playlistData.data.artistsNames || null,
                            tracklist: playlistData.data.song.items.map(track => ({
                                title: track.title,
                                artists: track.artistsNames,
                                link: track.link ? `https://zingmp3.vn${track.link}` : null
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

        songData.releaseDate = albumData.data.releaseDate || null;
        songData.providedBy = albumData.data.distributor || null;
        songData.albumOwner = albumData.data.artistsNames || null;

        songData.tracklist = albumData.data.song.items
            .filter(track => track.artistsNames.toLowerCase().includes(mainArtist))
            .map(track => ({
                title: track.title,
                artists: track.artistsNames,
                link: track.link ? `https://zingmp3.vn${track.link}` : null
            }));

       
        const matchingTrack = albumData.data.song.items.find(track => track.encodeId === songId);
        if (matchingTrack && !songData.link) {
            songData.link = matchingTrack.link ? `https://zingmp3.vn${matchingTrack.link}` : null;
        }
    }
}

module.exports = new ZingController();
