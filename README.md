# 🏦 Funder Acquisition Agent

An AI-powered web scraping agent that automatically searches the internet for funding opportunities, investors, grants, and venture capital firms. Recovers up to 100 funders per day with full contact details.

## 🚀 Features

- **Real-time Web Search** - Searches DuckDuckGo, Bing, and specialized funding databases
- **Smart Data Extraction** - Extracts emails, phone numbers, addresses from websites
- **Multiple Funder Types** - Venture Capital, Angel Investors, Grants, Private Equity, Government Programs, Crowdfunding
- **Persistent Storage** - Saves all findings to local database
- **Beautiful Dashboard** - Modern, responsive UI with filtering and search history
- **Export Functionality** - Export funders to JSON for further processing

## 📋 Retrieved Information

For each funder, the agent retrieves:
- ✅ Funder Name
- ✅ Funder Type
- ✅ Email Address
- ✅ Phone Number
- ✅ Physical Address
- ✅ Website URL
- ✅ Funding Range
- ✅ Region/Country
- ✅ Description

## 🛠️ Installation

```bash
# Clone the repository
git clone https://github.com/ThandoHlomuka/funder-acquisition-agent.git

# Navigate to directory
cd funder-acquisition-agent

# Install dependencies
npm install

# Start the server
npm start
```

## 🌐 Usage

1. Open http://localhost:3001 in your browser
2. Enter keywords (e.g., "Technology", "Agriculture", "Healthcare")
3. Select filters (type, region, minimum amount)
4. Click "Search Funders"
5. Results appear with full contact details
6. Save, delete, or export funders as needed

## 🔧 Tech Stack

- **Backend**: Node.js, Express
- **Web Scraping**: Cheerio, Node Fetch
- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Database**: JSON file storage

## 📊 Architecture

```
┌─────────────────┐
│   Dashboard     │  ← User enters keywords
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Backend API    │  ← Searches web sources
└────────┬────────┘
         │
         ├─► DuckDuckGo
         ├─► Bing Search
         ├─► Crunchbase
         ├─► AngelList
         ├─► Grant Databases
         └─► Foundation Directories
              │
              ▼
         ┌─────────────┐
         │  Extract    │  ← Emails, phones, addresses
         └──────┬──────┘
                │
                ▼
         ┌─────────────┐
         │   Save to   │  ← Local JSON database
         │   Database  │
         └─────────────┘
```

## 🎯 API Endpoints

- `GET /api/search-funders?keywords=technology&funderType=all&region=USA` - Search for funders
- `GET /api/funders` - Get all saved funders

## 📈 Capacity

- Up to **100 funders per search**
- Multiple searches per day
- Automatic deduplication
- Persistent storage across sessions

## 🔒 Privacy & Ethics

- Respects website robots.txt
- Uses appropriate User-Agent headers
- Rate-limited requests
- No sensitive data scraping

## 🤝 Contributing

Pull requests are welcome. For major changes, please open an issue first.

## 📄 License

Copyright © 2026 Thando Hlomuka. All rights reserved.

This software is the exclusive property of Thando Hlomuka. Unauthorized copying, distribution, or use of this software, via any medium, is strictly prohibited.

For licensing inquiries, contact: thando@metramarket.co.za
