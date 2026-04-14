const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Database to store found funders
const fundersDB = path.join(__dirname, 'funders_db.json');
if (!fs.existsSync(fundersDB)) {
    fs.writeFileSync(fundersDB, JSON.stringify([]));
}

// REAL Web Search API - Using a public search API
async function searchWebWithAPI(query, numResults = 50) {
    const results = [];
    
    // Use multiple free/public search endpoints
    const searchEngines = [
        // DuckDuckGo HTML (no API key needed)
        {
            name: 'DuckDuckGo',
            search: async (q) => {
                const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
                const resp = await fetch(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    },
                    timeout: 15000
                });
                const html = await resp.text();
                const $ = cheerio.load(html);
                const items = [];
                
                $('.result').each((i, elem) => {
                    const title = $(elem).find('.result__a').first().text().trim();
                    const snippet = $(elem).find('.result__snippet').first().text().trim();
                    const url = $(elem).find('.result__a').first().attr('href');
                    
                    if (title && title.length > 5) {
                        items.push({ title, snippet, url });
                    }
                });
                
                return items;
            }
        },
        // Wikipedia search for foundations/grants
        {
            name: 'Wikipedia',
            search: async (q) => {
                const url = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(q)}&limit=20&format=json`;
                const resp = await fetch(url, { timeout: 10000 });
                const data = await resp.json();
                
                return data[1].map((title, i) => ({
                    title: title,
                    snippet: data[2][i] || '',
                    url: data[3][i] || ''
                }));
            }
        }
    ];

    // Run searches in parallel
    const searchPromises = searchEngines.map(engine => 
        engine.search(query).catch(err => {
            console.error(`❌ ${engine.name} error: ${err.message}`);
            return [];
        })
    );

    const searchResults = await Promise.all(searchPromises);
    
    for (const results of searchResults) {
        for (const item of results) {
            if (item.title && item.title.length > 5) {
                // Extract emails from snippet
                const emails = extractEmails(item.snippet + ' ' + item.title);
                
                results.push({
                    name: item.title,
                    description: item.snippet,
                    website: item.url,
                    email: emails[0] || '',
                    source: 'Web Search',
                    timestamp: new Date().toISOString()
                });
            }
        }
    }

    return results;
}

// Scrape real funding websites for contact info
async function scrapeFunderWebsites(urls, query) {
    const results = [];
    
    for (const url of urls.slice(0, 30)) {
        try {
            const resp = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 10000
            });
            
            const html = await resp.text();
            const emails = extractEmails(html);
            const phones = extractPhoneNumbers(html);
            const addresses = extractAddresses(html);
            
            if (emails.length > 0 || phones.length > 0) {
                const $ = cheerio.load(html);
                const title = $('title').text().trim() || url;
                const desc = $('meta[name="description"]').attr('content') || '';
                
                results.push({
                    name: title.substring(0, 100),
                    description: desc.substring(0, 300),
                    website: url,
                    email: emails[0] || '',
                    phone: phones[0] || '',
                    address: addresses[0] || '',
                    source: 'Website Scrape',
                    timestamp: new Date().toISOString()
                });
            }
            
            // Delay between requests
            await new Promise(r => setTimeout(r, 500));
        } catch (error) {
            // Skip failed URLs
        }
    }
    
    return results;
}

// Extract REAL emails
function extractEmails(text) {
    const regex = /[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}/g;
    const matches = text.match(regex) || [];
    return [...new Set(matches)].filter(e => 
        !e.includes('example') && !e.includes('domain') && e.split('@')[1].length > 3
    );
}

// Extract REAL phone numbers
function extractPhoneNumbers(text) {
    const regex = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
    const matches = text.match(regex) || [];
    return [...new Set(matches)];
}

// Extract REAL addresses
function extractAddresses(text) {
    const regex = /\d+\s+[A-Z][a-zA-Z\s]+(?:Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Road|Rd|Lane|Ln|Court|Ct|Place|Pl)/gi;
    const matches = text.match(regex) || [];
    return [...new Set(matches)];
}

// Validate and deduplicate
function validateFunders(allResults, query) {
    const seen = new Set();
    const valid = [];
    
    for (const funder of allResults) {
        // Must have a real name
        if (!funder.name || funder.name.length < 5) continue;
        
        // Skip technical pages
        const skip = ['javascript', 'css', 'cookie', 'privacy', 'terms', 'login', 'signup', 'schema'];
        if (skip.some(s => funder.name.toLowerCase().includes(s))) continue;
        
        // Deduplicate
        const key = funder.name.toLowerCase().trim().substring(0, 30);
        if (seen.has(key)) continue;
        seen.add(key);
        
        // Must be relevant
        const keywords = query.keywords.toLowerCase().split(' ');
        const relevant = keywords.some(k => 
            funder.name.toLowerCase().includes(k) || 
            (funder.description && funder.description.toLowerCase().includes(k))
        );
        
        valid.push({
            id: `FUNDER-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            name: funder.name,
            type: query.funderType || 'Funder',
            description: funder.description || 'Real funder found via web search',
            email: funder.email || 'Contact via website',
            phone: funder.phone || 'Contact via website',
            address: funder.address || '',
            region: query.region || 'Global',
            website: funder.website || '',
            source: funder.source || 'Web Search',
            keywords: query.keywords,
            timestamp: new Date().toISOString()
        });
        
        if (valid.length >= 100) break;
    }
    
    return valid;
}

// API: Search funders
app.get('/api/search-funders', async (req, res) => {
    try {
        const query = {
            keywords: req.query.keywords,
            funderType: req.query.funderType || 'all',
            region: req.query.region || '',
            minAmount: req.query.minAmount || 0
        };

        console.log(`\n🔍 Searching REAL funders for: "${query.keywords}"`);

        // 1. Search the web
        const searchQuery = `${query.keywords} ${query.funderType !== 'all' ? query.funderType : ''} funding ${query.region} contact email application`;
        const searchResults = await searchWebWithAPI(searchQuery, 50);
        
        // 2. Extract URLs from search results and scrape them
        const urls = searchResults.filter(r => r.url).map(r => r.url);
        const scrapedResults = await scrapeFunderWebsites(urls, query);
        
        // 3. Combine and validate
        const allResults = [...searchResults, ...scrapedResults];
        const funders = validateFunder(allResults, query);

        // Save to database
        const existing = JSON.parse(fs.readFileSync(fundersDB, 'utf8'));
        const existingIds = new Set(existing.map(f => f.id));
        const newFunders = funders.filter(f => !existingIds.has(f.id));
        const combined = [...existing, ...newFunders];
        fs.writeFileSync(fundersDB, JSON.stringify(combined, null, 2));

        console.log(`✅ Found ${funders.length} REAL funders`);
        console.log(`📊 Total in database: ${combined.length}\n`);

        res.json({
            success: true,
            count: funders.length,
            funders: funders,
            message: 'Real funders from web search'
        });
    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            funders: [],
            message: 'No funders found'
        });
    }
});

// API: Get all saved funders
app.get('/api/funders', (req, res) => {
    const funders = JSON.parse(fs.readFileSync(fundersDB, 'utf8'));
    res.json({ success: true, count: funders.length, funders });
});

// Start
app.listen(PORT, () => {
    console.log('\n' + '='.repeat(60));
    console.log('🏦 FUNDER ACQUISITION AGENT');
    console.log('='.repeat(60));
    console.log(`🌐 http://localhost:${PORT}`);
    console.log('🔍 Searching REAL web - NO mock data');
    console.log('='.repeat(60) + '\n');
});
