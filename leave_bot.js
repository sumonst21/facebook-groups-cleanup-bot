const puppeteer = require('puppeteer-core');
const fs = require('fs');

const CONCURRENT_WORKERS = 2;
const REPORT_PATH = '/home/sumonst21/leave-fb-groups/cleanup_report.json';

let mode = 'less-than';
let targetCount = 10000;

for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '--all') {
        mode = 'all';
    } else if (arg === '--less-than' || arg === '-l') {
        mode = 'less-than';
        targetCount = parseInt(process.argv[++i], 10);
    } else if (arg === '--greater-than' || arg === '-g') {
        mode = 'greater-than';
        targetCount = parseInt(process.argv[++i], 10);
    }
}

async function run() {
    console.log(`Starting bot in mode: ${mode}` + (mode !== 'all' ? ` ${targetCount}` : ''));
    let browser;
    try {
        console.log(`Trying to connect to browser at http://127.0.0.1:9222...`);
        browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
    } catch (e) {
        console.log(`Connection failed. Launching /opt/google/chrome/chrome locally with user data...`);
        browser = await puppeteer.launch({
            executablePath: '/opt/google/chrome/chrome',
            userDataDir: '/home/sumonst21/.config/google-chrome',
            defaultViewport: null,
            headless: "new",
            args: ['--no-sandbox']
        });
    }
    
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
        
        while (groupsToLeave.length < CONCURRENT_WORKERS * 5 && scrolls < 20) {
            scrolls++;
            const groups = await mainPage.evaluate(({ mode, targetCount }) => {
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
                        if (parent.querySelector('a[role="link"]') && parent.querySelector('a[role="link"]').href.includes('/groups/')) {
                            let cardContainer = parent.parentElement ? parent.parentElement : parent;
                            cardContainer = cardContainer.parentElement ? cardContainer.parentElement : cardContainer;
                            cardsMap.set(cardContainer, cardContainer);
                            break;
                        }
                        parent = parent.parentElement;
                    }
                });

                for (const card of cardsMap.values()) {
                    const linkNode = Array.from(card.querySelectorAll('a[role="link"]')).find(a => a.href.includes('/groups/'));
                    const name = linkNode ? (linkNode.innerText || linkNode.textContent).trim().split('\n')[0] : 'Unknown';
                    const url = linkNode ? linkNode.href : '';
                    
                    const memberNode = card.querySelector('a[href*="/members/"]');
                    const memberCountText = memberNode ? memberNode.innerText : '0';
                    const memberCount = parseMembers(memberCountText);

                    if (url.includes('/groups/')) {
                        let shouldLeave = false;
                        if (mode === 'all') shouldLeave = true;
                        else if (mode === 'less-than' && memberCount < targetCount) shouldLeave = true;
                        else if (mode === 'greater-than' && memberCount > targetCount) shouldLeave = true;
                        
                        // Extract base group ID for deduplication
                        const cleanUrl = url.split('?')[0];

                        if (shouldLeave) {
                            results.push({ name, url: cleanUrl, members: memberCount });
                        }
                    }
                }
                return results;
            }, { mode, targetCount });

            // Filter out ones we've already processed or plan to
            for (const g of groups) {
                if (!processedUrls.has(g.url) && !groupsToLeave.find(x => x.url === g.url)) {
                    groupsToLeave.push(g);
                }
            }

            if (groupsToLeave.length < CONCURRENT_WORKERS * 5) {
                // Use human-like keyboard scrolling
                await mainPage.focus('body').catch(() => {});
                for(let k=0; k<10; k++) {
                    await mainPage.keyboard.press('PageDown');
                    await new Promise(r => setTimeout(r, 200));
                }
                await new Promise(r => setTimeout(r, 3000));
            }
        }

        if (groupsToLeave.length === 0) {
            consecutiveEmptyScrolls++;
            if (consecutiveEmptyScrolls >= 3) {
                console.log("No new eligible groups found. Performing a hard refresh of the page to clear left groups from the DOM...");
                await mainPage.reload({ waitUntil: 'domcontentloaded' });
                await new Promise(r => setTimeout(r, 5000));
                consecutiveEmptyScrolls = 0; // reset to try again post-reload
                // If it still loops after reload and finds nothing, we will add a hard bailout counter if needed.
                // But let's check if the page actually has groups via DOM:
                const hasGroups = await mainPage.evaluate(() => document.querySelectorAll('a[href*="/groups/"]').length > 0);
                if (!hasGroups) {
                    console.log("Groups page completely empty. Finite end reached.");
                    break;
                }
                continue;
            }
            console.log(`No new eligible groups in this scroll (attempt ${consecutiveEmptyScrolls}/3), scrolling further...`);
            await mainPage.focus('body').catch(() => {});
            for(let k=0; k<20; k++) {
                await mainPage.keyboard.press('PageDown');
                await new Promise(r => setTimeout(r, 100));
            }
            await new Promise(r => setTimeout(r, 4000));
            continue;
        }

        consecutiveEmptyScrolls = 0;
        console.log(`Queueing ${groupsToLeave.length} groups for concurrent processing...`);
        
        let localLeftGroups = [];
        let queue = [...groupsToLeave];

        // Worker Loop - Heavily throttled to evade Facebook Action Blocks
        async function workerTask(workerPage, workerId) {
            // Stagger parallel workers so they don't fire at the same millisecond
            await new Promise(r => setTimeout(r, workerId * 4000));
            
            while (queue.length > 0) {
                const group = queue.shift();
                processedUrls.add(group.url); 
                
                console.log(`[Worker ${workerId}] Processing ${group.name} (${group.members} members)`);
                try {
                    await workerPage.goto(group.url, { waitUntil: 'domcontentloaded' });
                    
                    const result = await workerPage.evaluate(async () => {
                        const sleep = ms => new Promise(r => setTimeout(r, ms));
                        
                        // Check for hard action block modal
                        if (document.body.innerText.includes("Action Blocked") || document.body.innerText.includes("You can't use this feature right now")) {
                            return 'Action Blocked';
                        }
                        
                        // Heavy random human jitter (3 to 6 seconds)
                        await sleep(3000 + Math.random() * 3000);
                        
                        let leaveItem = null;
                        for (let clickAttempt = 0; clickAttempt < 3; clickAttempt++) {
                            const joinedBtn = document.querySelector('div[aria-label="Joined"]');
                            if (!joinedBtn) {
                                if (document.querySelector('div[aria-label="Join Group"]') || document.querySelector('div[aria-label="Join community"]')) {
                                    return 'Success'; // We are already not in it
                                }
                                return 'No Joined button';
                            }
                            joinedBtn.click();
                            
                            // Wait for dropdown
                            await sleep(2000 + Math.random() * 1500);
                            const menuItems = Array.from(document.querySelectorAll('div[role="menuitem"], span[dir="auto"]'));
                            leaveItem = menuItems.find(el => {
                                const txt = (el.innerText || '').toLowerCase();
                                return txt.includes('leave group') || txt.includes('leave community');
                            });
                            if (leaveItem) break;
                            await sleep(1000); // small delay before retry
                        }
                        
                        if (!leaveItem) return 'No Leave group menu item';
                        leaveItem.click();
                        
                        // Wait for confirm modal
                        await sleep(2000 + Math.random() * 1500);
                        const btns = Array.from(document.querySelectorAll('div[role="button"], span'));
                        const confirmBtn = btns.find(el => {
                            const txt = (el.innerText || '').trim().toLowerCase();
                            const label = (el.getAttribute('aria-label') || '').toLowerCase();
                            return txt === 'leave group' || txt === 'leave community' || txt === 'leave' || label === 'leave group' || label === 'leave community';
                        });
                        if (!confirmBtn) return 'No Confirm button';
                        confirmBtn.click();
                        
                        await sleep(2000 + Math.random() * 1000);
                        return 'Success';
                    });
                    
                    if (result === 'Success') {
                        localLeftGroups.push(group);
                        console.log(`[Worker ${workerId}] -> Successfully left ${group.name}!`);
                    } else {
                        console.log(`[Worker ${workerId}] -> Error: ${result}`);
                        await workerPage.screenshot({ path: `/home/sumonst21/leave-fb-groups/debug_${workerId}_${Date.now()}.png` }).catch(()=>{});
                        if (result === 'Action Blocked') {
                            console.log(`\n\n[!!!] FACEBOOK HAS TEMPORARILY BLOCKED YOUR ACCOUNT FROM LEAVING GROUPS DUE TO RATE LIMITS.\n`);
                        }
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
