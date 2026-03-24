/**
 * Facebook Group Unfollow Snippet
 * 
 * Instructions:
 * 1. Navigate to https://www.facebook.com/groups/joins/
 * 2. Click the 'Settings' gear icon in the Sidebar.
 * 3. Click 'Following'.
 * 4. Scroll down the modal to load all groups you want to unfollow.
 * 5. Open Browser Console (F12 -> Console) and paste this entire script.
 */
const clickUnfollowButtons = async () => {
  // 1. Select all elements with role="button" that have an aria-label containing "Unfollow"
  const buttons = Array.from(document.querySelectorAll('[role="button"][aria-label*="Unfollow"]'));
  
  console.log(`Found ${buttons.length} potential buttons.`);

  for (const button of buttons) {
    // 2. Double check the internal text to ensure it says "Unfollow"
    if (button.innerText.includes('Unfollow')) {
      button.scrollIntoView({ behavior: 'smooth', block: 'center' });
      button.click();
      
      console.log('Clicked an Unfollow button!');

      // 3. Wait 1 second between clicks to be safe
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  console.log('Finished clicking all visible buttons.');
};

clickUnfollowButtons();
