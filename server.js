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

// Real web search sources for funders
const FUNDER_SOURCES = [
    { 
        name: 'Grants.gov', 
        searchUrl: 'https://www.grants.gov/search-grants', 
        type: 'grant',
        real: true 
    },
    { 
        name: 'Foundation Center', 
        searchUrl: 'https://fdo.foundationcenter.org', 
        type: 'foundation',
        real: true 
    },
    { 
        name: 'GrantStation', 
        searchUrl: 'https://www.grantstation.com/grantmaker-search', 
        type: 'grant',
        real: true 
    },
    { 
        name: 'Crunchbase', 
        searchUrl: 'https://www.crunchbase.com/search', 
        type: 'venture-capital',
        real: true 
    },
    { 
        name: 'AngelList', 
        searchUrl: 'https://angel.co/investors', 
        type: 'angel-investor',
        real: true 
    },
    { 
        name: 'EU Funding', 
        searchUrl: 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/home', 
        type: 'government',
        real: true 
    },
    { 
        name: 'Gov.uk Funding', 
        searchUrl: 'https://www.gov.uk/government/publications', 
        type: 'government',
        real: true 
    },
    { 
        name: 'SA Gov Funding', 
        searchUrl: 'https://www.gov.za/services/business-development-funding', 
        type: 'government',
        real: true 
    },
    { 
        name: 'PEI Media', 
        searchUrl: 'https://www.peimedia.com', 
        type: 'private-equity',
        real: true 
    },
    { 
        name: 'FundingCircle', 
        searchUrl: 'https://www.fundingcircle.com', 
        type: 'crowdfunding',
        real: true 
    },
    { 
        name: 'Kickstarter', 
        searchUrl: 'https://www.kickstarter.com', 
        type: 'crowdfunding',
        real: true 
    },
    { 
        name: 'Indiegogo', 
        searchUrl: 'https://www.indiegogo.com', 
        type: 'crowdfunding',
        real: true 
    }
];

// Search funders using multiple web sources
async function searchFundersWeb(query) {
    const results = [];
    const { keywords, funderType, region, minAmount } = query;

    // Build search queries for different sources
    const searchQueries = [
        `${keywords} ${funderType !== 'all' ? funderType : ''} funding ${region || ''} contact email`,
        `${keywords} investors ${region || ''} "contact us" email phone address`,
        `${keywords} grants funding opportunities ${region || ''} apply contact`,
        `${keywords} "venture capital" OR "angel investors" ${region || ''} "contact"`,
        `${keywords} foundation grant maker ${region || ''} email application`
    ];

    // Search using DuckDuckGo (no API key required)
    for (const searchQuery of searchQueries) {
        try {
            const ddgResults = await searchDuckDuckGo(searchQuery);
            results.push(...ddgResults);
            console.log(`✅ DuckDuckGo: ${ddgResults.length} results`);
        } catch (error) {
            console.error(`❌ DuckDuckGo error: ${error.message}`);
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Scrape specific funder directories
    for (const source of FUNDER_SOURCES) {
        try {
            const sourceResults = await scrapeFunderSource(source, query);
            results.push(...sourceResults);
            console.log(`✅ ${source.name}: ${sourceResults.length} results`);
        } catch (error) {
            console.error(`❌ ${source.name} error: ${error.message}`);
        }

        // Delay between requests
        await new Promise(resolve => setTimeout(resolve, 1500));
    }

    // Remove duplicates and validate
    const uniqueResults = deduplicateFunders(results);
    
    // ONLY return real data - no mock data
    const realFunders = validateRealFunders(uniqueResults, query);
    
    console.log(`🎯 Total real funders found: ${realFunders.length}`);
    
    return realFunders;
}

// Search DuckDuckGo HTML (real search results)
async function searchDuckDuckGo(query) {
    const results = [];
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

    const response = await fetch(searchUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        timeout: 15000
    });

    const html = await response.text();
    const $ = cheerio.load(html);

    // Extract search results
    $('.result').each((i, elem) => {
        const title = $(elem).find('.result__a').first().text().trim();
        const snippet = $(elem).find('.result__snippet').first().text().trim();
        const url = $(elem).find('.result__a').first().attr('href');

        if (title && snippet && title.length > 5) {
            // Extract emails from snippet
            const emails = extractEmails(snippet);
            
            results.push({
                name: title,
                description: snippet,
                website: url || '',
                email: emails[0] || '',
                source: 'DuckDuckGo',
                searchQuery: query,
                timestamp: new Date().toISOString()
            });
        }
    });

    return results;
}

// Scrape specific funder sources for REAL data
async function scrapeFunderSource(source, query) {
    const results = [];
    
    try {
        const response = await fetch(source.url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 15000
        });

        const html = await response.text();
        const $ = cheerio.load(html);

        // Extract REAL emails, phones, addresses from the page
        const emails = extractEmails(html);
        const phones = extractPhoneNumbers(html);
        const addresses = extractAddresses(html);

        // Find real funder/investor links
        const fundLinks = [];
        $('a').each((i, elem) => {
            const href = $(elem).attr('href');
            const text = $(elem).text().trim();
            
            if (text && text.length > 8 && text.length < 150 &&
                (text.toLowerCase().includes('fund') || 
                 text.toLowerCase().includes('invest') || 
                 text.toLowerCase().includes('grant') ||
                 text.toLowerCase().includes('capital') ||
                 text.toLowerCase().includes('foundation'))) {
                
                fundLinks.push({
                    name: text,
                    href: href ? new URL(href, source.url).href : source.url
                });
            }
        });

        // For each funder found, try to get their contact page
        for (const fund of fundLinks.slice(0, 20)) { // Limit to avoid overload
            try {
                const fundResult = await extractFunderContact(fund, source, query);
                if (fundResult && fundResult.name) {
                    results.push(fundResult);
                }
            } catch (error) {
                // Skip failed extractions
            }
        }
        
        // If we couldn't find individual funders, add the source itself if it has contact info
        if (results.length === 0 && emails.length > 0) {
            results.push({
                name: source.name,
                type: source.type,
                website: source.url,
                email: emails[0],
                phone: phones[0] || '',
                address: addresses[0] || '',
                source: source.name,
                description: `Funding platform - ${source.name}`,
                timestamp: new Date().toISOString()
            });
        }
    } catch (error) {
        console.error(`❌ Error scraping ${source.name}: ${error.message}`);
    }

    return results;
}

// Extract contact info from individual funder pages
async function extractFunderContact(fund, source, query) {
    try {
        const response = await fetch(fund.href, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 10000
        });

        const html = await response.text();
        const $ = cheerio.load(html);

        // Extract REAL contact info
        const emails = extractEmails(html);
        const phones = extractPhoneNumbers(html);
        const addresses = extractAddresses(html);

        // Get description
        const description = $('meta[name="description"]').attr('content') || 
                           $('p').first().text().trim().substring(0, 300);

        return {
            name: fund.name,
            type: source.type,
            website: fund.href,
            email: emails[0] || '',
            phone: phones[0] || '',
            address: addresses[0] || '',
            description: description || '',
            source: source.name,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        return null;
    }
}

// Extract REAL emails from HTML
function extractEmails(html) {
    const emailRegex = /[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}/g;
    const emails = html.match(emailRegex) || [];
    // Filter out common false positives
    return [...new Set(emails)].filter(email => 
        !email.includes('example') && 
        !email.includes('domain') &&
        !email.includes('schema') &&
        email.split('@')[1].length > 3
    );
}

// Extract REAL phone numbers from HTML
function extractPhoneNumbers(html) {
    const phoneRegex = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
    const phones = html.match(phoneRegex) || [];
    return [...new Set(phones)];
}

// Extract REAL addresses from HTML
function extractAddresses(html) {
    const addressRegex = /\d+\s+[A-Z][a-zA-Z\s]+(?:Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Road|Rd|Lane|Ln|Court|Ct|Place|Pl)/gi;
    const addresses = html.match(addressRegex) || [];
    return [...new Set(addresses)];
}

// Deduplicate funders by name
function deduplicateFunders(funders) {
    const seen = new Set();
    return funders.filter(funder => {
        const key = funder.name.toLowerCase().trim().substring(0, 30);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// Validate and return ONLY real funders
function validateRealFunders(funders, query) {
    const validated = [];
    
    for (const funder of funders) {
        // Must have a real name
        if (!funder.name || funder.name.length < 5) continue;
        
        // Filter out technical/non-funder pages
        const excludeTerms = [
            'javascript', 'css', 'script', 'cookie', 'privacy', 
            'terms', 'login', 'signup', 'register', 'schema',
            'api', 'developer', 'documentation'
        ];
        
        const nameLower = funder.name.toLowerCase();
        if (excludeTerms.some(term => nameLower.includes(term))) continue;
        
        // Must be relevant to the search
        const keywords = query.keywords.toLowerCase().split(' ');
        const isRelevant = keywords.some(keyword => 
            nameLower.includes(keyword) || 
            (funder.description && funder.description.toLowerCase().includes(keyword))
        );
        
        if (!isRelevant && funders.length > 20) continue; // Be more selective if we have many results
        
        validated.push({
            id: `FUNDER-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
            name: funder.name,
            type: funder.type || query.funderType || 'Unknown',
            description: funder.description || '',
            email: funder.email || 'Not available',
            phone: funder.phone || 'Not available',
            address: funder.address || 'Not available',
            region: query.region || 'Global',
            website: funder.website || '',
            source: funder.source || 'Web Search',
            keywords: query.keywords,
            timestamp: new Date().toISOString(),
            isReal: true
        });
        
        // Stop at 100
        if (validated.length >= 100) break;
    }
    
    return validated;
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

        console.log(`\n🔍 Searching REAL funders for: "${query.keywords}"`);
        console.log(`   Type: ${query.funderType}, Region: ${query.region || 'Global'}\n`);

        const funders = await searchFundersWeb(query);

        // Save to database
        const existing = JSON.parse(fs.readFileSync(fundersDB, 'utf8'));
        
        // Merge and deduplicate
        const existingIds = new Set(existing.map(f => f.id));
        const newFunders = funders.filter(f => !existingIds.has(f.id));
        const combined = [...existing, ...newFunders];
        
        fs.writeFileSync(fundersDB, JSON.stringify(combined, null, 2));

        console.log(`\n✅ Found ${funders.length} real funders`);
        console.log(`📊 Total in database: ${combined.length}\n`);

        res.json({
            success: true,
            count: funders.length,
            funders: funders,
            message: 'Real funders from web search'
        });
    } catch (error) {
        console.error('❌ Error searching funders:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            funders: [],
            message: 'No funders found'
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
    console.log('\n' + '='.repeat(60));
    console.log('🏦 FUNDER ACQUISITION AGENT');
    console.log('='.repeat(60));
    console.log(`🌐 Dashboard: http://localhost:${PORT}`);
    console.log(`🔍 API: http://localhost:${PORT}/api/search-funders`);
    console.log(`💾 Database: ${fundersDB}`);
    console.log('🎯 Searching web for REAL funders only');
    console.log('❌ NO mock data - Real results only');
    console.log('='.repeat(60) + '\n');
});
