const puppeteer = require('puppeteer-core');
const fs = require('fs');

async function unfollowAllGroups() {
    console.log("Connecting to active Chrome browser at http://127.0.0.1:9222...");
    const browser = await puppeteer.connect({ 
        browserURL: 'http://127.0.0.1:9222', 
        defaultViewport: null 
    });

    const page = await browser.newPage();
    console.log("Navigating to /groups/joins/...");
    await page.goto('https://www.facebook.com/groups/joins/', { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 3000));

    console.log("Opening Group Settings...");
    const gearSelector = 'div[aria-label="Edit Groups settings"]';
    await page.waitForSelector(gearSelector);
    
    // Pick the gear that is in the sidebar (left side)
    const gears = await page.$$(gearSelector);
    let sidebarGear = null;
    for (const g of gears) {
        const box = await g.boundingBox();
        if (box && box.x < 500) {
            sidebarGear = g;
            break;
        }
    }
    if (!sidebarGear) {
        console.error("Could not find the sidebar gear icon.");
        await page.close();
        await browser.disconnect();
        return;
    }
    await sidebarGear.click();
    await new Promise(r => setTimeout(r, 2000));

    console.log("Opening 'Following' modal...");
    await page.evaluate(() => {
        const menuItems = Array.from(document.querySelectorAll('div[role="menuitem"], a[role="menuitem"], span'));
        const target = menuItems.find(m => (m.innerText || '').includes('Following'));
        if (target) target.click();
    });
    await new Promise(r => setTimeout(r, 4000));

    let totalUnfollowed = 0;
    let emptyScrolls = 0;

    console.log("Starting Unfollow loop...");
    while (emptyScrolls < 10) {
        const result = await page.evaluate(async () => {
            const sleep = ms => new Promise(r => setTimeout(r, ms));
            const dialog = document.querySelector('div[role="dialog"]');
            if (!dialog) return { status: 'no_dialog' };

            // Find rows in the modal. These usually have a "Following" button or a specific aria-label
            const rows = Array.from(dialog.querySelectorAll('div[data-visualcompletion="ignore-dynamic"], div[role="listitem"]'))
                .filter(el => el.innerText.length > 5 && !el.hasAttribute('data-unfollow-processed'));

            if (rows.length === 0) {
                // Scroll the modal container
                const scrollable = dialog.querySelector('div[style*="overflow-y: auto"]') || dialog.querySelector('.xb57i2i') || dialog;
                scrollable.scrollBy(0, 500);
                return { status: 'scrolled' };
            }

            let batchCount = 0;
            for (const row of rows) {
                // Find a button that either says "Following" or has a checkmark-like icon
                const followingBtn = Array.from(row.querySelectorAll('div[role="button"], div[aria-haspopup="menu"]'))
                                    .find(b => (b.innerText || '').toLowerCase().includes('following') || (b.getAttribute('aria-label') || '').toLowerCase().includes('following'));

                if (followingBtn) {
                    followingBtn.scrollIntoView({ block: 'center' });
                    followingBtn.click();
                    await sleep(1500 + Math.random() * 1000);

                    // Now find 'Unfollow' in the newly opened menu (which is likely outside the modal)
                    const menuItems = Array.from(document.querySelectorAll('div[role="menuitem"], span'));
                    const unfollow = menuItems.find(m => (m.innerText || '').toLowerCase().includes('unfollow'));
                    
                    if (unfollow) {
                        unfollow.click();
                        batchCount++;
                        await sleep(2000 + Math.random() * 1000);
                    } else {
                        // If no unfollow menu, maybe it's already toggled or we clicked wrong. Close menu if open.
                        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
                        await sleep(1000);
                    }
                }
                row.setAttribute('data-unfollow-processed', 'true');
            }

            return { status: 'processed', count: batchCount };
        });

        if (result.status === 'no_dialog') {
            console.error("The 'Following' modal was closed unexpectedly.");
            break;
        }

        if (result.status === 'scrolled') {
            emptyScrolls++;
            console.log(`No new groups found in modal. Scrolled... (Attempt ${emptyScrolls})`);
        } else {
            emptyScrolls = 0;
            totalUnfollowed += result.count;
            console.log(`Unfollowed ${result.count} groups in this batch. Total: ${totalUnfollowed}`);
        }

        // Small pause between batches
        await new Promise(r => setTimeout(r, 2000));
    }

    console.log(`Cleanup complete. Total groups unfollowed: ${totalUnfollowed}`);
    await page.close();
    await browser.disconnect();
}

unfollowAllGroups().catch(console.error);
