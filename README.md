# Report-Scraper

Firefox extension to scrape summaries of introduced HackerOne reports including status, last action, and last message.

The latest packaged release can be downloaded from [releases](https://github.com/trybadisch/Report-Scraper/releases/).

![Example GIF](example.gif)

## About this project

This extension attempts to summarize relevant HackerOne report information without the need to manually open each report.

To do so, 2 queries are sent to HackerOne's GraphQL endpoint for each entered report (`MetadataQuery` and `ReportTimelineQuery`). The following scraped information is then shown in a results table:

- Report ID
- H1 Program
- Report Status
- Report Title and Reporter
- Last Action taken, its author and date
- Last Message in timeline, its author and date

After reviewing each report's summary, relevant reports can be marked in order to open them in new tabs, simultaneously. These tabs won't be loaded until focused, to avoid H1's rate limit issues. The scraping itself is done in batches of 5 reports, for the same reason.

Non-public reports and reports from private programs will be queried if an active H1 session exists in the current browsing context.
