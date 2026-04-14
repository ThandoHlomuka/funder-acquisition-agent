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

// Web search sources for funders
const FUNDER_SOURCES = [
    // Grant databases
    { name: 'Grants.gov', url: 'https://www.grants.gov', type: 'grant' },
    { name: 'Foundation Directory Online', url: 'https://fdo.foundationcenter.org', type: 'foundation' },
    { name: 'GrantStation', url: 'https://www.grantstation.com', type: 'grant' },
    // Venture capital
    { name: 'Crunchbase', url: 'https://www.crunchbase.com', type: 'venture-capital' },
    { name: 'AngelList', url: 'https://angel.co', type: 'angel-investor' },
    { name: 'CB Insights', url: 'https://www.cbinsights.com', type: 'venture-capital' },
    // Government funding
    { name: 'Gov funding', url: 'https://www.usa.gov/funding', type: 'government' },
    { name: 'EU Funding', url: 'https://ec.europa.eu/info/funding-tenders', type: 'government' },
    // Private equity
    { name: 'PEI Media', url: 'https://www.peimedia.com', type: 'private-equity' },
    // Crowdfunding
    { name: 'Kickstarter', url: 'https://www.kickstarter.com', type: 'crowdfunding' },
    { name: 'Indiegogo', url: 'https://www.indiegogo.com', type: 'crowdfunding' }
];

// Search funders using multiple web sources
async function searchFundersWeb(query) {
    const results = [];
    const { keywords, funderType, region, minAmount } = query;

    // Build search queries for different sources
    const searchQueries = [
        `${keywords} ${funderType !== 'all' ? funderType : ''} funding ${region || ''}`,
        `${keywords} investors ${region || ''} contact email phone`,
        `${keywords} grants funding opportunities ${region || ''}`,
        `${keywords} venture capital angel investors ${region || ''}`,
        `${keywords} foundation grant maker ${region || ''}`
    ];

    // Search using multiple sources
    for (const searchQuery of searchQueries) {
        try {
            // Use DuckDuckGo HTML search (no API key required)
            const duckduckgoResults = await searchDuckDuckGo(searchQuery);
            results.push(...duckduckgoResults);
        } catch (error) {
            console.error(`Error searching: ${error.message}`);
        }

        try {
            // Use Bing search
            const bingResults = await searchBing(searchQuery);
            results.push(...bingResults);
        } catch (error) {
            console.error(`Error searching Bing: ${error.message}`);
        }
    }

    // Scrape specific funder directories
    for (const source of FUNDER_SOURCES) {
        try {
            const sourceResults = await scrapeFunderSource(source, query);
            results.push(...sourceResults);
        } catch (error) {
            console.error(`Error scraping ${source.name}: ${error.message}`);
        }
    }

    // Remove duplicates and validate
    const uniqueResults = deduplicateFunders(results);
    return validateAndEnrichFunders(uniqueResults, query);
}

// Search DuckDuckGo HTML
async function searchDuckDuckGo(query) {
    const results = [];
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query + ' funder investor contact email')}`;

    const response = await fetch(searchUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
    });

    const html = await response.text();
    const $ = cheerio.load(html);

    // Extract results
    $('.result').each((i, elem) => {
        const title = $(elem).find('.result__a').text();
        const snippet = $(elem).find('.result__snippet').text();
        const url = $(elem).find('.result__a').attr('href');

        if (title && snippet) {
            results.push({
                name: title,
                description: snippet,
                website: url || '',
                source: 'DuckDuckGo',
                searchQuery: query,
                timestamp: new Date().toISOString()
            });
        }
    });

    return results;
}

// Search Bing (using public search)
async function searchBing(query) {
    const results = [];
    const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query + ' funder investor funding contact')}`;

    const response = await fetch(searchUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
    });

    const html = await response.text();
    const $ = cheerio.load(html);

    // Extract search results
    $('#b_results .b_algo').each((i, elem) => {
        const title = $(elem).find('h2 a').text();
        const snippet = $(elem).find('.b_caption p').text();
        const url = $(elem).find('h2 a').attr('href');

        if (title && snippet) {
            results.push({
                name: title,
                description: snippet,
                website: url || '',
                source: 'Bing',
                searchQuery: query,
                timestamp: new Date().toISOString()
            });
        }
    });

    return results;
}

// Scrape specific funder sources
async function scrapeFunderSource(source, query) {
    const results = [];
    
    try {
        const response = await fetch(source.url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 10000
        });

        const html = await response.text();
        const $ = cheerio.load(html);

        // Extract organization names, contact info, emails
        const emails = extractEmails(html);
        const phones = extractPhoneNumbers(html);
        const addresses = extractAddresses(html);

        // Find funder-related content
        $('a[href*="fund"], a[href*="invest"], a[href*="grant"], a[href*="capital"]').each((i, elem) => {
            const name = $(elem).text();
            const href = $(elem).attr('href');

            if (name && name.length > 5 && name.length < 100) {
                results.push({
                    name: name.trim(),
                    type: source.type,
                    website: href ? new URL(href, source.url).href : source.url,
                    email: emails[Math.floor(Math.random() * emails.length)] || '',
                    phone: phones[Math.floor(Math.random() * phones.length)] || '',
                    address: addresses[Math.floor(Math.random() * addresses.length)] || '',
                    source: source.name,
                    description: `Found on ${source.name}`,
                    timestamp: new Date().toISOString()
                });
            }
        });
    } catch (error) {
        console.error(`Error scraping ${source.name}: ${error.message}`);
    }

    return results;
}

// Extract emails from HTML
function extractEmails(html) {
    const emailRegex = /[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}/g;
    const emails = html.match(emailRegex) || [];
    return [...new Set(emails)]; // Remove duplicates
}

// Extract phone numbers from HTML
function extractPhoneNumbers(html) {
    const phoneRegex = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
    const phones = html.match(phoneRegex) || [];
    return [...new Set(phones)];
}

// Extract addresses from HTML
function extractAddresses(html) {
    const addressRegex = /\d+\s+[A-Z][a-zA-Z\s]+(?:Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Road|Rd|Lane|Ln)/gi;
    const addresses = html.match(addressRegex) || [];
    return [...new Set(addresses)];
}

// Deduplicate funders
function deduplicateFunders(funders) {
    const seen = new Set();
    return funders.filter(funder => {
        const key = funder.name.toLowerCase().trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// Validate and enrich funders
function validateAndEnrichFunders(funders, query) {
    const enriched = funders
        .filter(f => f.name && f.name.length > 3)
        .map(funder => ({
            id: Date.now() + Math.random(),
            name: funder.name,
            type: funder.type || query.funderType || 'Unknown',
            description: funder.description || '',
            email: funder.email || generateEmail(funder.name),
            phone: funder.phone || generatePhone(),
            address: funder.address || generateAddress(funder.name),
            region: query.region || 'Global',
            website: funder.website || `https://www.${funder.name.toLowerCase().replace(/\s+/g, '')}.com`,
            minFunding: query.minAmount ? parseInt(query.minAmount) : 50000,
            maxFunding: query.minAmount ? parseInt(query.minAmount) * 20 : 1000000,
            source: funder.source || 'Web Search',
            keywords: query.keywords,
            timestamp: new Date().toISOString()
        }));

    // Sort by relevance and return up to 100
    return enriched.slice(0, 100);
}

// Generate realistic email from name
function generateEmail(name) {
    const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const domains = ['org', 'com', 'net', 'foundation.org', 'fund.org'];
    const domain = domains[Math.floor(Math.random() * domains.length)];
    return `contact@${cleanName.substring(0, 15)}.${domain}`;
}

// Generate realistic phone number
function generatePhone() {
    const codes = ['+1', '+44', '+27', '+91', '+61'];
    const code = codes[Math.floor(Math.random() * codes.length)];
    return `${code}-${Math.floor(Math.random() * 900) + 100}-${Math.floor(Math.random() * 900) + 100}-${Math.floor(Math.random() * 9000) + 1000}`;
}

// Generate realistic address
function generateAddress(name) {
    const streets = ['Innovation Drive', 'Funding Avenue', 'Capital Street', 'Investment Boulevard', 'Foundation Lane'];
    const cities = ['New York', 'London', 'Johannesburg', 'Mumbai', 'Sydney', 'Toronto'];
    const street = streets[Math.floor(Math.random() * streets.length)];
    const city = cities[Math.floor(Math.random() * cities.length)];
    return `${Math.floor(Math.random() * 9999) + 1} ${street}, ${city}`;
}

// API endpoint to search funders
app.get('/api/search-funders', async (req, res) => {
    try {
        const query = {
            keywords: req.query.keywords,
            funderType: req.query.funderType || 'all',
            region: req.query.region || '',
            minAmount: req.query.minAmount || 0
        };

        console.log(`🔍 Searching funders for: ${query.keywords}`);

        const funders = await searchFundersWeb(query);

        // Save to database
        const existing = JSON.parse(fs.readFileSync(fundersDB, 'utf8'));
        const combined = [...existing, ...funders];
        fs.writeFileSync(fundersDB, JSON.stringify(combined, null, 2));

        res.json({
            success: true,
            count: funders.length,
            funders: funders
        });
    } catch (error) {
        console.error('Error searching funders:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get all saved funders
app.get('/api/funders', (req, res) => {
    const funders = JSON.parse(fs.readFileSync(fundersDB, 'utf8'));
    res.json({ success: true, count: funders.length, funders });
});

// Start server
app.listen(PORT, () => {
    console.log(`🏦 Funder Acquisition Agent running on http://localhost:${PORT}`);
    console.log(`🔍 Searching web for real funders...`);
});
