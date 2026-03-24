const puppeteer = require('puppeteer-core');
const fs = require('fs');

async function run() {
    console.log("Connecting to browser at http://localhost:9222...");
    const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null });
    
    // Find facebook page
    let pages = await browser.pages();
    let page = pages.find(p => p.url().includes('facebook.com'));
    if (!page) {
        page = await browser.newPage();
    }
    
    console.log("Navigating to groups list...");
    await page.goto('https://www.facebook.com/sumonst21/groups', { waitUntil: 'domcontentloaded' });
    
    console.log("Collecting groups with < 10k members...");
    let groupsToLeave = [];
    let attempts = 0;
    
    while (groupsToLeave.length < 15 && attempts < 15) {
        attempts++;
        const groups = await page.evaluate(() => {
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

        // Filter against ones we already know
        for (const g of groups) {
            if (!groupsToLeave.find(x => x.url === g.url)) {
                groupsToLeave.push(g);
            }
        }

        if (groupsToLeave.length < 15) {
            console.log(`Found ${groupsToLeave.length} matching groups. Scrolling for more...`);
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await new Promise(r => setTimeout(r, 4000));
        }
    }

    groupsToLeave = groupsToLeave.slice(0, 15); // only do a batch of 15
    console.log(`\nReady to leave ${groupsToLeave.length} groups.`);
    
    let leftGroups = [];

    // Leave the groups by visiting them directly
    for (let i = 0; i < groupsToLeave.length; i++) {
        const group = groupsToLeave[i];
        console.log(`[${i+1}/${groupsToLeave.length}] Processing ${group.name} (${group.members} members)`);
        
        try {
            await page.goto(group.url, { waitUntil: 'domcontentloaded' });
            
            // Wait heavily and interact fully inside the browser context
            const result = await page.evaluate(async () => {
                const sleep = ms => new Promise(r => setTimeout(r, ms));
                
                // 1. Click Joined
                await sleep(3000);
                const joinedBtn = document.querySelector('div[aria-label="Joined"]');
                if (!joinedBtn) return 'No Joined button';
                joinedBtn.click();
                
                // 2. Click Leave group in menu
                await sleep(2000);
                const menuItems = Array.from(document.querySelectorAll('div[role="menuitem"]'));
                const leaveItem = menuItems.find(el => el.innerText && el.innerText.includes('Leave group'));
                if (!leaveItem) return 'No Leave group menu item';
                leaveItem.click();
                
                // 3. Confirm Leave
                await sleep(2000);
                const btns = Array.from(document.querySelectorAll('div[role="button"], span'));
                const confirmBtn = btns.find(el => {
                    const txt = (el.innerText || '').trim();
                    const label = el.getAttribute('aria-label') || '';
                    return txt === 'Leave Group' || txt === 'Leave group' || txt === 'Leave' || label === 'Leave Group';
                });
                
                if (!confirmBtn) {
                    return 'No Confirm button';
                }
                confirmBtn.click();
                
                await sleep(2000);
                return 'Success';
            });
            
            console.log(`  -> ${result}`);
            if (result === 'Success') {
                leftGroups.push(group);
            } else if (result === 'No Confirm button') {
                await page.screenshot({ path: `/home/sumonst21/leave-fb-groups/fail_confirm_${i}.png` });
            }

        } catch (err) {
            console.log(`  -> Error leaving group: ${err.message}`);
        }
    }

    // Save final stats
    const reportPath = '/home/sumonst21/leave-fb-groups/cleanup_report.json';
    let report = [];
    if (fs.existsSync(reportPath)) {
        report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    }
    report.push(...leftGroups);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log(`\nBatch complete. Left ${leftGroups.length} groups.`);
    console.log(`You can run this script again to process the next batch!`);
    
    // Disconnect so user's browser stays open
    await browser.disconnect();
}

run().catch(console.error);
