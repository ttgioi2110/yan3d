const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 7860;
const BASE_URL = 'https://yanhh3d.pw';

const MANIFEST = {
    id: 'org.yanhh3d.puppeteer.v1',
    version: '1.0.0',
    name: 'YanHH3D - Puppeteer Engine',
    description: 'Addon xem phim Hoạt Hình 3D Trung Quốc (Direct Stream)',
    resources: ['catalog', 'meta', 'stream'],
    types: ['series'],
    idPrefixes: ['yhnode_'],
    catalogs: [{ type: 'series', id: 'yhnode_catalog', name: 'YanHH3D - Mới Cập Nhật' }]
};

// 1. MANIFEST
app.get('/manifest.json', (req, res) => res.json(MANIFEST));

// 2. CATALOG
app.get('/catalog/series/yhnode_catalog.json', async (req, res) => {
    try {
        const fetchRes = await fetch(`${BASE_URL}/moi-cap-nhat`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        const html = await fetchRes.text();
        const metas = [];

        const ignoredSlugs = ['page', 'moi-cap-nhat', 'da-hoan-thanh', 'dang-chieu', 'phim-le', 'ova', 'thong-bao', 'category', 'tag', 'genre'];
        const itemRegex = /<a[^>]+href=["']https?:\/\/yanhh3d\.pw\/([^"']+)["'][^>]*title=["']([^"']+)["'][^>]*>[\s\S]*?<img[^>]+(?:src|data-src)=["']([^"']+)["']/gi;
        let match;

        while ((match = itemRegex.exec(html)) !== null) {
            const rawSlug = match[1].replace(/\/$/, '');
            const title = match[2].trim();
            const poster = match[3];

            if (rawSlug && !ignoredSlugs.some(ign => rawSlug.includes(ign))) {
                const cleanSlug = rawSlug.replace(/[^a-zA-Z0-9_-]/g, '');
                const id = `yhnode_${cleanSlug}`;

                if (!metas.some(m => m.id === id)) {
                    metas.push({
                        id: id,
                        type: 'series',
                        name: title,
                        poster: poster.startsWith('http') ? poster : `${BASE_URL}${poster}`
                    });
                }
            }
        }
        res.json({ metas });
    } catch (e) {
        res.json({ metas: [] });
    }
});

// 3. META (CHI TIẾT & TẬP)
app.get('/meta/series/:id.json', async (req, res) => {
    try {
        const id = req.params.id;
        const slug = id.replace('yhnode_', '');
        const filmUrl = `${BASE_URL}/${slug}`;

        const fetchRes = await fetch(filmUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        const html = await fetchRes.text();

        const titleMatch = html.match(/<h1[^>]*>(.*?)<\/h1>/i);
        const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : 'Phim 3D';

        const posterMatch = html.match(/<img[^>]+src=["']([^"']+)["'][^>]*class=["'][^"']*poster[^"']*["']/i) || html.match(/<article[\s\S]*?<img[^>]+src=["']([^"']+)["']/i);
        let poster = posterMatch ? posterMatch[1] : '';
        if (poster && !poster.startsWith('http')) poster = `${BASE_URL}${poster}`;

        const videos = [];
        const addedEpisodes = new Set();
        const epLinkRegex = /<(?:a|button)[^>]+(?:href|data-href)=["']([^"']*tap-(\d+)[^"']*)["'][^>]*>(.*?)<\/(?:a|button)>/gi;
        let epMatch;

        while ((epMatch = epLinkRegex.exec(html)) !== null) {
            const epNum = parseInt(epMatch[2], 10);
            if (!addedEpisodes.has(epNum)) {
                addedEpisodes.add(epNum);
                videos.push({
                    id: `${id}:${epNum}`,
                    title: `Tập ${epNum}`,
                    season: 1,
                    episode: epNum
                });
            }
        }

        if (videos.length === 0) {
            const epMatches = [...html.matchAll(/tap-(\d+)/gi)];
            let maxEp = 1;
            if (epMatches.length > 0) {
                epMatches.forEach(m => {
                    const num = parseInt(m[1], 10);
                    if (num > maxEp) maxEp = num;
                });
            }
            for (let i = 1; i <= maxEp; i++) {
                videos.push({ id: `${id}:${i}`, title: `Tập ${i}`, season: 1, episode: i });
            }
        } else {
            videos.sort((a, b) => a.episode - b.episode);
        }

        res.json({
            meta: { id, type: 'series', name: title, poster, videos }
        });
    } catch (e) {
        res.json({ meta: null });
    }
});

// 4. STREAM (PUPPETEER HEADLESS BẮT .M3U8)
app.get('/stream/series/:id.json', async (req, res) => {
    const id = req.params.id;
    const parts = id.split(':');
    const epNum = parts[1];
    const slug = parts[0].replace('yhnode_', '');
    const epUrl = `${BASE_URL}/${slug}/tap-${epNum}`;

    let browser = null;
    let m3u8Url = null;

    try {
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36');

        // Bắt mọi network request trên trang
        page.on('request', request => {
            const reqUrl = request.url();
            if (reqUrl.includes('.m3u8') || reqUrl.includes('.fbcdn.cloud')) {
                if (!m3u8Url) m3u8Url = reqUrl;
            }
        });

        await page.goto(epUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

        // Chờ 3s để JavaScript kích hoạt player
        await page.waitForTimeout(3000);
    } catch (err) {
        console.error('Puppeteer Error:', err.message);
    } finally {
        if (browser) await browser.close();
    }

    const host = `${req.protocol}://${req.get('host')}`;
    const streams = [];

    if (m3u8Url) {
        const proxyUrl = `${host}/m3u8-proxy?url=${encodeURIComponent(m3u8Url)}&ref=${encodeURIComponent(epUrl)}`;
        streams.push({
            title: `YanHH3D - Tập ${epNum} (Direct Fast)`,
            url: proxyUrl
        });
    }

    streams.push({
        title: `YanHH3D - Mở Trình Duyệt Web`,
        externalUrl: epUrl
    });

    res.json({ streams });
});

// 5. M3U8 PROXY
app.get('/m3u8-proxy', async (req, res) => {
    const targetUrl = req.query.url;
    const referer = req.query.ref || BASE_URL;

    if (!targetUrl) return res.status(400).send('Missing URL');

    try {
        const response = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': referer
            }
        });

        const contentType = response.headers.get('content-type') || '';
        const host = `${req.protocol}://${req.get('host')}`;

        if (targetUrl.includes('.m3u8') || contentType.includes('mpegurl') || contentType.includes('apple')) {
            let content = await response.text();
            const baseUrlObj = new URL(targetUrl);

            const lines = content.split('\n').map(line => {
                let trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#')) {
                    let absUrl = trimmed.startsWith('http') ? trimmed : new URL(trimmed, baseUrlObj.href).href;
                    return `${host}/m3u8-proxy?url=${encodeURIComponent(absUrl)}&ref=${encodeURIComponent(referer)}`;
                }
                return line;
            });

            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Content-Type', 'application/x-mpegURL');
            return res.send(lines.join('\n'));
        } else {
            res.setHeader('Access-Control-Allow-Origin', '*');
            const arrayBuffer = await response.arrayBuffer();
            return res.send(Buffer.from(arrayBuffer));
        }
    } catch (err) {
        res.status(500).send('Proxy Error');
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));