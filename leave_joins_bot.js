const puppeteer = require('puppeteer-core');

async function run() {
    console.log("Connecting to active Chrome browser at http://127.0.0.1:9222...");
    const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
    
    let pages = await browser.pages();
    let page = pages.find(p => p.url().includes('/groups/joins'));
    if (!page) {
        console.log("Navigating to /groups/joins/...");
        page = await browser.newPage();
        await page.goto('https://www.facebook.com/groups/joins/', { waitUntil: 'domcontentloaded' });
    } else {
        console.log("Found existing /groups/joins/ tab. Bringing to front...");
        await page.bringToFront();
    }
    
    console.log("Starting inline cleanup loop on Groups Manager page...");

    let totalLeft = 0;
    let emptyScrolls = 0;
    
    while (true) {
        const result = await page.evaluate(async () => {
            const sleep = ms => new Promise(r => setTimeout(r, ms));
            
            // Find all unmarked "..." More options buttons
            // On /groups/joins/ they have aria-label="More"
            const dotsBtns = Array.from(document.querySelectorAll('div[aria-label="More"], div[aria-label="More options"]'))
                            .filter(b => {
                                const rect = b.getBoundingClientRect();
                                return rect.width > 0 && rect.height > 0 && !b.hasAttribute('data-leave-processed');
                            });
                            
            if (dotsBtns.length === 0) {
                window.scrollBy(0, window.innerHeight);
                await sleep(2500);
                return { left: 0, status: 'scrolled' };
            }
            
            let leftCount = 0;
            // Process in batches of 5
            for (let i = 0; i < Math.min(dotsBtns.length, 5); i++) {
                const btn = dotsBtns[i];
                btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                await sleep(1000);
                
                // Click "..."
                btn.click();
                await sleep(2000);
                
                // Find Leave group in dropdown
                const menuItems = Array.from(document.querySelectorAll('div[role="menuitem"], span[dir="auto"]'));
                const leaveItem = menuItems.find(el => {
                    const txt = (el.innerText || '').toLowerCase();
                    return txt.includes('leave group') || txt.includes('leave community');
                });
                
                if (leaveItem) {
                    leaveItem.click();
                    await sleep(2000); // Wait for modal
                    
                    // Specific confirm button
                    const confirmBtns = Array.from(document.querySelectorAll('div[role="button"], span'));
                    const confirmBtn = confirmBtns.find(el => {
                        const txt = (el.innerText || '').trim().toLowerCase();
                        const label = (el.getAttribute('aria-label') || '').toLowerCase();
                        return txt === 'leave group' || txt === 'leave community' || txt === 'leave' || label === 'leave group' || label === 'leave community';
                    });
                    
                    if (confirmBtn) {
                        confirmBtn.click();
                        leftCount++;
                        // Wait for the modal dismissal to complete
                        await sleep(2500 + Math.random() * 1500);
                    } else {
                        // Close modal cleanly if 'Confirm' isn't there
                        const closeBtns = Array.from(document.querySelectorAll('div[aria-label="Close"], div[aria-label="Cancel"]'));
                        if (closeBtns.length > 0) closeBtns[closeBtns.length - 1].click();
                        await sleep(1000);
                    }
                } else {
                    // "Leave group" wasn't in the menu. Click body to dismiss menu.
                    document.body.click();
                    await sleep(1000);
                }
                
                // Always mark processed so we don't get stuck in an infinite click loop
                btn.setAttribute('data-leave-processed', 'true');
            }
            
            return { left: leftCount, status: 'processed' };
        });

        if (result.status === 'scrolled') {
            emptyScrolls++;
            console.log(`No unprocessed groups found in view. Scrolled down... (Attempt ${emptyScrolls})`);
            
            if (emptyScrolls >= 10) {
                console.log("End of groups list reached. We have processed all loaded groups.");
                emptyScrolls = 0;
            }
        } else {
            emptyScrolls = 0;
            totalLeft += result.left;
            console.log(`Processed batch. Successfully left ${result.left} groups. Total for session: ${totalLeft}`);
            
            if (totalLeft > 0 && totalLeft % 100 === 0) {
                console.log("Reached 100 groups milestone. Reloading the page to keep memory light...");
                await page.reload({ waitUntil: 'domcontentloaded' });
                await new Promise(r => setTimeout(r, 6000));
            } else {
                // Small jitter between batches
                await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
            }
        }
    }
}

run().catch(console.error);
