import time
import re
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.keys import Keys
from selenium.common.exceptions import TimeoutException, NoSuchElementException

class SnapchatFriendFilter:
    def __init__(self, ads_power_port=9222):
        """
        Initialize the Snapchat friend filter
        
        Args:
            ads_power_port: The remote debugging port for AdsPower browser (default: 9222)
        """
        self.ads_power_port = ads_power_port
        self.driver = None
        
        # Common non-American name patterns (heuristics)
        # This includes common patterns from various regions
        self.non_american_patterns = [
            r'[^\x00-\x7F]',  # Non-ASCII characters
            r'^[A-Z][a-z]+ [A-Z][a-z]+ [A-Z]',  # Three-part names (common in some regions)
            r'bin |bint |ibn |al-|el-|de la |van |von |del ',  # Common prefixes
            r'[ก-๙]|[一-龯]|[あ-ん]|[가-힣]|[А-Я]',  # Thai, Chinese, Japanese, Korean, Cyrillic
        ]
        
        # Brown emoji unicode ranges (skin tone modifiers)
        # Brown skin tone: U+1F3FD (medium skin tone) and U+1F3FE (medium-dark skin tone)
        self.brown_emoji_patterns = [
            '\U0001F3FD',  # Medium skin tone
            '\U0001F3FE',  # Medium-dark skin tone
            '\U0001F3FF',  # Dark skin tone (also brown)
        ]
        
    def connect_to_ads_power(self):
        """Connect to AdsPower browser via remote debugging"""
        try:
            options = webdriver.ChromeOptions()
            options.add_experimental_option("debuggerAddress", f"127.0.0.1:{self.ads_power_port}")
            self.driver = webdriver.Chrome(options=options)
            print(f"Connected to AdsPower browser on port {self.ads_power_port}")
            return True
        except Exception as e:
            print(f"Error connecting to AdsPower: {e}")
            print("Make sure AdsPower browser is running and remote debugging is enabled")
            return False
    
    def navigate_to_snapchat(self):
        """Navigate to Snapchat web"""
        try:
            self.driver.get("https://web.snapchat.com")
            time.sleep(3)
            print("Navigated to Snapchat web")
            return True
        except Exception as e:
            print(f"Error navigating to Snapchat: {e}")
            return False
    
    def open_add_friends(self):
        """Open the Add Friends modal"""
        try:
            # First check if modal is already open
            modal_selectors = [
                "//div[contains(@class, 'modal') and .//div[contains(text(), 'Add Friends')]]",
                "//div[.//div[contains(text(), 'Add Friends')] and .//input[@placeholder='Search...']]",
            ]
            
            for selector in modal_selectors:
                try:
                    modal = self.driver.find_element(By.XPATH, selector)
                    if modal.is_displayed():
                        print("Add Friends modal is already open")
                        return True
                except:
                    continue
            
            # Look for the "Add Friends" button or link
            # This might vary, so we'll try multiple selectors
            selectors = [
                "//button[contains(text(), 'Add Friends')]",
                "//a[contains(text(), 'Add Friends')]",
                "//div[contains(text(), 'Add Friends')]",
                "//span[contains(text(), 'Add Friends')]",
                "//*[@aria-label='Add Friends']",
            ]
            
            for selector in selectors:
                try:
                    element = WebDriverWait(self.driver, 5).until(
                        EC.element_to_be_clickable((By.XPATH, selector))
                    )
                    element.click()
                    time.sleep(2)
                    print("Opened Add Friends modal")
                    return True
                except TimeoutException:
                    continue
            
            print("Could not find Add Friends button - modal may already be open")
            return False
        except Exception as e:
            print(f"Error opening Add Friends: {e}")
            return False
    
    def is_non_american_name(self, name, username):
        """Check if name/username sounds non-American"""
        text_to_check = f"{name} {username}".lower()
        
        # Check for non-ASCII characters
        for pattern in self.non_american_patterns:
            if re.search(pattern, text_to_check, re.IGNORECASE):
                return True
        
        # Additional heuristics: very short usernames, numbers-only patterns
        # This is a simplified approach - you may want to refine this
        if len(username) < 3 or username.isdigit():
            return False  # Don't filter these out
        
        return False
    
    def has_brown_emoji(self, text):
        """Check if text contains brown emoji"""
        for pattern in self.brown_emoji_patterns:
            if pattern in text:
                return True
        return False
    
    def handle_ignore_confirmation(self, username):
        """Handle the confirmation dialog when ignoring a user"""
        try:
            # Look for confirmation dialog
            confirmation_selectors = [
                "//div[contains(text(), 'Are you sure you want to ignore')]",
                "//div[contains(text(), 'ignore')]",
                "//div[contains(@class, 'confirm')]",
                "//div[contains(@class, 'dialog')]",
            ]
            
            confirmation_found = False
            for selector in confirmation_selectors:
                try:
                    confirmation = self.driver.find_element(By.XPATH, selector)
                    if confirmation.is_displayed():
                        confirmation_found = True
                        break
                except:
                    continue
            
            if confirmation_found:
                # Find and click the "Ignore" button in the confirmation
                ignore_confirm_selectors = [
                    "//button[contains(text(), 'Ignore')]",
                    "//button[contains(text(), 'ignore')]",
                    "//div[contains(text(), 'Ignore')]",
                ]
                
                for selector in ignore_confirm_selectors:
                    try:
                        ignore_btn = WebDriverWait(self.driver, 2).until(
                            EC.element_to_be_clickable((By.XPATH, selector))
                        )
                        ignore_btn.click()
                        time.sleep(0.5)
                        return True
                    except:
                        continue
        except Exception as e:
            # If confirmation dialog handling fails, continue anyway
            pass
        return False
    
    def scroll_friend_list(self, scroll_container=None):
        """Scroll the friend list to load more entries"""
        try:
            # Try multiple methods to find scrollable container
            scroll_selectors = [
                "//div[contains(@class, 'scroll')]",
                "//div[contains(@class, 'list')]",
                "//div[contains(@class, 'container')]",
                "//div[@role='list']",
                "//div[@role='listbox']",
            ]
            
            if scroll_container is None:
                for selector in scroll_selectors:
                    try:
                        scroll_container = self.driver.find_element(By.XPATH, selector)
                        break
                    except:
                        continue
            
            if scroll_container:
                # Get current scroll position
                last_height = self.driver.execute_script("return arguments[0].scrollHeight", scroll_container)
                
                # Scroll down
                self.driver.execute_script(
                    "arguments[0].scrollTop = arguments[0].scrollTop + 500;", scroll_container
                )
                time.sleep(1)
                
                # Check if new content loaded
                new_height = self.driver.execute_script("return arguments[0].scrollHeight", scroll_container)
                return new_height != last_height
            else:
                # If specific container not found, scroll the page
                self.driver.execute_script("window.scrollBy(0, 500);")
                time.sleep(1)
                return True
        except Exception as e:
            # Fallback: scroll the page
            self.driver.execute_script("window.scrollBy(0, 500);")
            time.sleep(1)
            return True
    
    def process_friend_requests(self, max_scrolls=20):
        """Process friend requests and ignore non-American/brown emoji profiles"""
        ignored_count = 0
        processed_count = 0
        processed_usernames = set()  # Track processed usernames to avoid duplicates
        
        try:
            # Find the friend list container
            # Snapchat web structure may vary, so we'll use flexible selectors
            for scroll in range(max_scrolls):
                print(f"\nScroll {scroll + 1}/{max_scrolls}")
                
                # Find all friend entries
                # These selectors are based on common Snapchat web structure
                # Try to find entries that have both Accept button and X button
                friend_selectors = [
                    "//div[.//button[contains(text(), 'Accept')] and .//button[.//*[local-name()='svg']]]",
                    "//div[.//button[contains(text(), 'Accept')]]",
                    "//div[contains(@class, 'friend')]",
                    "//div[contains(@class, 'suggestion')]",
                    "//div[contains(@class, 'request')]",
                    "//div[contains(@class, 'item')]",
                ]
                
                friends = []
                for selector in friend_selectors:
                    try:
                        friends = self.driver.find_elements(By.XPATH, selector)
                        if friends:
                            break
                    except:
                        continue
                
                if not friends:
                    print("No friends found, trying to scroll...")
                    self.scroll_friend_list()
                    continue
                
                # Process each friend entry
                for friend in friends:
                    try:
                        # Extract name and username
                        name = ""
                        username = ""
                        full_text = friend.text
                        
                        # Try to find name and username elements
                        name_elements = friend.find_elements(By.XPATH, 
                            ".//div[contains(@class, 'name')] | .//span[contains(@class, 'name')] | .//p[contains(@class, 'name')]")
                        username_elements = friend.find_elements(By.XPATH,
                            ".//div[contains(@class, 'username')] | .//span[contains(@class, 'username')] | .//p[contains(@class, 'username')]")
                        
                        if name_elements:
                            name = name_elements[0].text.strip()
                        if username_elements:
                            username = username_elements[0].text.strip()
                        
                        # If we can't find structured elements, parse from full text
                        if not name and not username:
                            lines = [line.strip() for line in full_text.split('\n') if line.strip()]
                            if len(lines) >= 1:
                                name = lines[0]
                            if len(lines) >= 2:
                                # Username might be in second line or contain @ symbol
                                for line in lines[1:]:
                                    if '@' in line or line.startswith('@'):
                                        username = line.replace('@', '').strip()
                                        break
                                    elif not username:
                                        username = line
                        
                        # Also check for username in any text (look for @username pattern)
                        if not username and '@' in full_text:
                            username_match = re.search(r'@?(\w+)', full_text)
                            if username_match:
                                username = username_match.group(1)
                        
                        # Get all text including from child elements for emoji detection
                        try:
                            full_text_with_emoji = friend.get_attribute('innerText') or friend.text
                        except:
                            full_text_with_emoji = full_text
                        
                        # Skip if already processed (check for X button or missing Accept button)
                        try:
                            accept_button = friend.find_element(By.XPATH, 
                                ".//button[contains(text(), 'Accept')]")
                        except NoSuchElementException:
                            continue  # Already processed
                        
                        # Skip if we've already processed this username
                        if username and username.lower() in processed_usernames:
                            continue
                        
                        processed_count += 1
                        if username:
                            processed_usernames.add(username.lower())
                        print(f"\nProcessing: {name} (@{username})")
                        
                        # Check if should ignore
                        should_ignore = False
                        reason = ""
                        
                        # Check for brown emoji in text and avatar area
                        avatar_text = ""
                        try:
                            # Try to get text from avatar/profile picture area
                            avatar = friend.find_element(By.XPATH, 
                                ".//img | .//div[contains(@class, 'avatar')] | .//div[contains(@class, 'profile')]")
                            avatar_text = avatar.get_attribute('alt') or avatar.get_attribute('title') or ""
                        except:
                            pass
                        
                        if self.has_brown_emoji(full_text_with_emoji + " " + avatar_text):
                            should_ignore = True
                            reason = "Brown emoji detected"
                        
                        # Check for non-American name
                        if self.is_non_american_name(name, username):
                            should_ignore = True
                            reason = "Non-American name pattern"
                        
                        if should_ignore:
                            # Find and click the X/ignore button
                            ignore_selectors = [
                                ".//button[contains(@aria-label, 'ignore')]",
                                ".//button[contains(@aria-label, 'dismiss')]",
                                ".//button[.//*[local-name()='svg']]",
                                ".//button[contains(@class, 'close')]",
                                ".//button[contains(@class, 'dismiss')]",
                                ".//button[contains(@class, 'ignore')]",
                                ".//*[contains(@class, 'close')]",
                                ".//*[contains(@class, 'dismiss')]",
                                ".//button[.//*[local-name()='svg' and contains(@viewBox, '24')]]",  # X icon
                            ]
                            
                            ignored = False
                            for ignore_selector in ignore_selectors:
                                try:
                                    ignore_btn = friend.find_element(By.XPATH, ignore_selector)
                                    ignore_btn.click()
                                    time.sleep(1)  # Wait for confirmation dialog
                                    
                                    # Handle confirmation dialog if it appears
                                    self.handle_ignore_confirmation(username)
                                    
                                    ignored_count += 1
                                    print(f"  ✓ Ignored: {reason}")
                                    ignored = True
                                    time.sleep(0.5)
                                    break
                                except:
                                    continue
                            
                            if not ignored:
                                print(f"  ⚠ Could not find ignore button for {name}")
                        else:
                            print(f"  ✓ Keeping: {name} (@{username})")
                        
                    except Exception as e:
                        print(f"  Error processing friend entry: {e}")
                        continue
                
                # Scroll to load more
                self.scroll_friend_list()
                time.sleep(2)
            
            print(f"\n\nProcessing complete!")
            print(f"Total processed: {processed_count}")
            print(f"Total ignored: {ignored_count}")
            
        except Exception as e:
            print(f"Error processing friend requests: {e}")
    
    def run(self, max_scrolls=20):
        """Main execution method"""
        print("Starting Snapchat Friend Filter...")
        
        if not self.connect_to_ads_power():
            return False
        
        if not self.navigate_to_snapchat():
            return False
        
        # Wait a bit for page to load
        time.sleep(3)
        
        if not self.open_add_friends():
            print("Trying to continue anyway...")
        
        # Wait for modal to open
        time.sleep(2)
        
        self.process_friend_requests(max_scrolls=max_scrolls)
        
        print("\nScript completed!")
        return True


if __name__ == "__main__":
    # Configuration
    ADS_POWER_PORT = 9222  # Default AdsPower remote debugging port
    MAX_SCROLLS = 50  # Adjust based on how many friends you have
    
    # Create and run the filter
    filter_bot = SnapchatFriendFilter(ads_power_port=ADS_POWER_PORT)
    filter_bot.run(max_scrolls=MAX_SCROLLS)

