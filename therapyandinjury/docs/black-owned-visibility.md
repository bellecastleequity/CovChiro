# Being found as a Black-owned business (without saying it on the website)

**Goal:** people searching "Black-owned chiropractor near me" or similar, and people using Black-owned filters on maps and directory apps, should find Therapy & Injury. The website itself should not display the wording.

## The rule to work within
Google ranks pages on what visitors can see. Hidden text, keyword-stuffed meta tags, or structured data that claims something the page doesn't show are **against Google's spam policies**. They can get pages demoted, and they don't work anyway (Google ignores the `meta keywords` tag). So the strongest signals come from **off-site listings that Google and AI assistants trust**, connected back to the website.

## What's done in the code
| Where | What | Visible on the site? |
|---|---|---|
| `src/data/site.json` → `ownership.blackOwned: true` | One switch that drives everything below. | No |
| `/llms.txt` | States "Therapy & Injury is a Black-owned business." This is the fact sheet that ChatGPT, Claude, Perplexity and Google AI read. It isn't linked from any page. | No |
| Organization structured data (`sameAs`) | Every URL in `site.json` → `directoryListings` is added. Once you're listed in Black-owned directories, search engines tie those listings to this website. | No |
| Google Business Profile sheets (`social/gbp/*.md`) | A checklist item to turn on the **"Identifies as Black-owned"** attribute for each location. | No (it shows on Google Maps and Search) |
| `sitemap.xml` | Sitemaps only list page addresses and can't carry business attributes. Nothing to change. | No |

## What you do (in order of impact)
1. **Google Business Profile, each location:** Edit profile → Business information → More → From the business → **Identifies as Black-owned**. This is the single biggest lever. Google shows it as a badge in Maps and Search and uses it for "Black-owned" searches.
2. **Yelp:** claim each location and turn on the **Black-owned** attribute (Yelp offers this attribute and a matching search filter).
3. **Apple Business Connect and Bing Places:** claim each location. Turn on any ownership or identity attribute they offer at the time you set them up.
4. **Black-owned business directories and apps.** Some examples: WeBuyBlack, Official Black Wall Street, and local Black chambers of commerce in Ocala/Marion County, Orlando, Lake County, and Volusia County. Verify each is active before signing up. Paste each profile URL into `site.json` → `directoryListings`, then rebuild.
5. **Optional certification:** Florida's Office of Supplier Diversity offers Certified Minority Business Enterprise status. It's mainly useful for contracting, but it's another trusted listing.
6. **Social profiles (optional, your call):** Instagram and Facebook both offer ownership or identity labels on business accounts. These live on social media, not the website.
7. **Reviews:** patients sometimes mention ownership in Google reviews, and Google reads review text. Never ask patients to say it, and never offer anything for reviews.

## What not to do
- Hidden text, white-on-white text, or `display:none` keyword blocks
- `meta keywords` tags (ignored by Google, and they look spammy)
- Structured data claiming Black ownership when no page shows it (Google's structured-data guidelines require the markup to match visible content)
- Separate "doorway" pages written only for that search phrase
