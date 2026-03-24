const puppeteer = require('puppeteer-core');

async function run() {
    console.log("Connecting to browser at http://127.0.0.1:9222...");
    const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
    
    // Find or create the feed page
    let pages = await browser.pages();
    let page = pages.find(p => p.url().includes('/groups/feed') || p.url().includes('/groups/joins'));
    if (!page) {
        page = await browser.newPage();
        await page.goto('https://www.facebook.com/groups/feed', { waitUntil: 'domcontentloaded' });
    } else {
        await page.bringToFront();
    }
    
    console.log("Ensuring we are on the Membership modal...");
    
    await page.evaluate(async () => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        
        // Determine if modal is already open
        if (document.body.innerText.includes("Leave groups that no longer interest you")) {
            return;
        }

        // 1. Click Settings (gear icon)
        const settingsBtns = Array.from(document.querySelectorAll('div[role="button"], a[role="link"]'))
            .filter(b => b.getAttribute('aria-label') && (b.getAttribute('aria-label').includes('Settings') || b.getAttribute('aria-label').includes('Groups settings')));
        
        if (settingsBtns.length > 0) {
            settingsBtns[0].click();
            await sleep(2500);
        }
        
        // 2. Click Membership
        const menuItems = Array.from(document.querySelectorAll('div[role="menuitem"], a[role="menuitem"]'));
        const membershipItem = menuItems.find(m => (m.innerText || '').includes('Membership'));
        if (membershipItem) {
            membershipItem.click();
            await sleep(3500);
        }
    });

    console.log("Modal initialized. Starting cleanup loop...");

    let totalLeft = 0;
    let emptyScrolls = 0;

    while(true) {
        const result = await page.evaluate(async () => {
            const sleep = ms => new Promise(r => setTimeout(r, ms));
            
            // Find all visible "Leave" buttons in the DOM
            let leaveBtns = Array.from(document.querySelectorAll('div[role="button"], span[dir="auto"]')).filter(b => {
                const txt = (b.innerText || '').trim();
                return txt === 'Leave' && b.offsetHeight > 0;
            });
            
            if (leaveBtns.length === 0) {
                // Scroll the modal
                const dialogs = document.querySelectorAll('div[role="dialog"]');
                if (dialogs.length > 0) {
                    const dialog = dialogs[dialogs.length - 1]; // topmost modal
                    
                    // Try to scroll the specific list container
                    const scrollers = dialog.querySelectorAll('div[style*="overflow"], div[data-visualcompletion="ignore-dynamic"]');
                    let scrolled = false;
                    for(const scroller of scrollers) {
                        if (scroller.scrollHeight > scroller.clientHeight) {
                            scroller.scrollBy(0, 800);
                            scrolled = true;
                            break;
                        }
                    }
                    if (!scrolled) dialog.scrollBy(0, 800); // Fallback
                    
                    await sleep(3000);
                    return { left: 0, status: 'scrolled' };
                }
                return { left: 0, status: 'no_buttons' };
            }

            let leftCount = 0;
            // Process one by one carefully
            for (let i = 0; i < Math.min(leaveBtns.length, 5); i++) {
                const btn = leaveBtns[i];
                btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                await sleep(500);
                
                // Click Leave
                btn.click();
                await sleep(2000); // Wait for confirm modal
                
                // Click confirm leave
                const confirmBtns = Array.from(document.querySelectorAll('div[role="button"]')).filter(b => {
                    const txt = (b.innerText || '').trim().toLowerCase();
                    const label = (b.getAttribute('aria-label') || '').toLowerCase();
                    return txt === 'leave group' || txt === 'leave community' || txt === 'leave' || label === 'leave group' || label === 'leave community';
                });
                
                if (confirmBtns.length > 0) {
                    const target = confirmBtns[confirmBtns.length - 1];
                    target.click();
                    leftCount++;
                    await sleep(2500 + Math.random() * 1500);
                } else {
                    // Dismiss the confirmation dialogue or action blocked modal if missing
                    const closeBtns = Array.from(document.querySelectorAll('div[aria-label="Close"], div[aria-label="Cancel"]'));
                    if (closeBtns.length > 0) closeBtns[closeBtns.length - 1].click();
                    await sleep(1000);
                }
            }
            
            return { left: leftCount, status: 'processed' };
        });

        if (result.status === 'no_buttons') {
            console.log("No more Leave buttons found. Ending.");
            break;
        } else if (result.status === 'scrolled') {
            emptyScrolls++;
            console.log(`Scrolled modal, waiting for more groups... (attempt ${emptyScrolls})`);
            if (emptyScrolls >= 4) {
                console.log("No new groups loaded after extensive scrolling. Finite end reached.");
                break;
            }
        } else {
            emptyScrolls = 0;
            totalLeft += result.left;
            console.log(`Processed ${result.left} groups from modal. Total this session: ${totalLeft}`);
            
            // Random anti-bot delay between batches
            const jitter = Math.random() * 3000;
            await new Promise(r => setTimeout(r, 2000 + jitter));
        }
    }
    
    console.log("Finished cleanup from modal.");
    await browser.disconnect();
}

run().catch(console.error);
