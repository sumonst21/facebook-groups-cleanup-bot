const puppeteer = require('puppeteer-core');
const fs = require('fs');

const CONCURRENT_WORKERS = 3;
const TARGET_MEMBERS = 10000;
const REPORT_PATH = '/home/sumonst21/leave-fb-groups/cleanup_report.json';

async function run() {
    console.log(`Connecting to browser at http://localhost:9222...`);
    const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null });
    
    // Load existing report to avoid reprocessing
    let report = [];
    if (fs.existsSync(REPORT_PATH)) {
        report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
    }
    const processedUrls = new Set(report.map(g => g.url));

    // Find or create main page
    let pages = await browser.pages();
    let mainPage = pages.find(p => p.url().includes('facebook.com/sumonst21/groups') || p.url().includes('facebook.com'));
    if (!mainPage) {
        mainPage = await browser.newPage();
    }
    
    console.log("Navigating to groups list on Main Page...");
    await mainPage.goto('https://www.facebook.com/sumonst21/groups', { waitUntil: 'domcontentloaded' });
    
    // Create worker pages
    const workers = [];
    for (let i = 0; i < CONCURRENT_WORKERS; i++) {
        workers.push(await browser.newPage());
    }

    let globalLeftCount = 0;
    let consecutiveEmptyScrolls = 0;

    while (true) {
        console.log(`\n--- Collecting new batch of groups... ---`);
        let groupsToLeave = [];
        let scrolls = 0;
        
        while (groupsToLeave.length < CONCURRENT_WORKERS * 5 && scrolls < 10) {
            scrolls++;
            const groups = await mainPage.evaluate(() => {
                function parseMembers(text) {
                    if (!text) return 0;
                    const matches = text.match(/([\d.]+)([KM]?)/i);
                    if (!matches) return 0;
                    let num = parseFloat(matches[1]);
                    const unit = matches[2].toUpperCase();
                    if (unit === 'K') num *= 1000;
                    if (unit === 'M') num *= 1000000;
                    return num;
                }

                let results = [];
                let cardsMap = new Map();
                document.querySelectorAll('a[href*="/members/"]').forEach(memberLink => {
                    let parent = memberLink.parentElement;
                    while (parent && parent !== document.body) {
                        if (parent.querySelector('a[role="link"]')) {
                            let cardContainer = parent.parentElement ? parent.parentElement : parent;
                            cardContainer = cardContainer.parentElement ? cardContainer.parentElement : cardContainer;
                            cardsMap.set(cardContainer, cardContainer);
                            break;
                        }
                        parent = parent.parentElement;
                    }
                });

                for (const card of cardsMap.values()) {
                    const nameNode = card.querySelector('a[role="link"] span');
                    const name = nameNode ? nameNode.innerText : 'Unknown';
                    const linkNode = card.querySelector('a[role="link"]');
                    const url = linkNode ? linkNode.href : '';
                    
                    const memberNode = card.querySelector('a[href*="/members/"]');
                    const memberCountText = memberNode ? memberNode.innerText : '0';
                    const memberCount = parseMembers(memberCountText);

                    if (memberCount < 10000 && url.includes('/groups/')) {
                        results.push({ name, url, members: memberCount });
                    }
                }
                return results;
            });

            // Filter out ones we've already processed or plan to
            for (const g of groups) {
                if (!processedUrls.has(g.url) && !groupsToLeave.find(x => x.url === g.url)) {
                    groupsToLeave.push(g);
                }
            }

            if (groupsToLeave.length < CONCURRENT_WORKERS * 5) {
                await mainPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                await new Promise(r => setTimeout(r, 4000));
            }
        }

        if (groupsToLeave.length === 0) {
            consecutiveEmptyScrolls++;
            if (consecutiveEmptyScrolls >= 3) {
                console.log("No new eligible groups found after extensive scrolling. Finite end reached.");
                break;
            }
            console.log("No new eligible groups in this scroll, trying again...");
            await mainPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await new Promise(r => setTimeout(r, 5000));
            continue;
        }

        consecutiveEmptyScrolls = 0;
        console.log(`Queueing ${groupsToLeave.length} groups for concurrent processing...`);
        
        let localLeftGroups = [];
        let queue = [...groupsToLeave];

        // Worker Loop
        async function workerTask(workerPage, workerId) {
            while (queue.length > 0) {
                const group = queue.shift();
                // Mark as processed regardless of success so we don't infinitely retry broken ones this session
                processedUrls.add(group.url); 
                
                console.log(`[Worker ${workerId}] Processing ${group.name} (${group.members} members)`);
                try {
                    await workerPage.goto(group.url, { waitUntil: 'domcontentloaded' });
                    
                    const result = await workerPage.evaluate(async () => {
                        const sleep = ms => new Promise(r => setTimeout(r, ms));
                        
                        await sleep(3000);
                        const joinedBtn = document.querySelector('div[aria-label="Joined"]');
                        if (!joinedBtn) return 'No Joined button';
                        joinedBtn.click();
                        
                        await sleep(2000);
                        const menuItems = Array.from(document.querySelectorAll('div[role="menuitem"]'));
                        const leaveItem = menuItems.find(el => el.innerText && el.innerText.includes('Leave group'));
                        if (!leaveItem) return 'No Leave group menu item';
                        leaveItem.click();
                        
                        await sleep(2000);
                        const btns = Array.from(document.querySelectorAll('div[role="button"], span'));
                        const confirmBtn = btns.find(el => {
                            const txt = (el.innerText || '').trim();
                            const label = el.getAttribute('aria-label') || '';
                            return txt === 'Leave Group' || txt === 'Leave group' || txt === 'Leave' || label === 'Leave Group';
                        });
                        if (!confirmBtn) return 'No Confirm button';
                        confirmBtn.click();
                        
                        await sleep(2000);
                        return 'Success';
                    });
                    
                    if (result === 'Success') {
                        localLeftGroups.push(group);
                        console.log(`[Worker ${workerId}] -> Successfully left ${group.name}!`);
                    } else {
                        console.log(`[Worker ${workerId}] -> Error: ${result}`);
                    }
                } catch (err) {
                    console.log(`[Worker ${workerId}] -> Exception: ${err.message}`);
                }
            }
        }

        // Run all workers concurrently
        await Promise.all(workers.map((w, i) => workerTask(w, i + 1)));

        // Save batch stats
        report.push(...localLeftGroups);
        fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
        globalLeftCount += localLeftGroups.length;
        console.log(`Batch complete. Saved ${localLeftGroups.length} successes. Total so far: ${globalLeftCount}`);
    }

    console.log(`\nAll done! Successfully left a total of ${globalLeftCount} groups.`);
    for (const w of workers) {
        await w.close();
    }
    await browser.disconnect();
}

run().catch(console.error);
