x// Script to check the current environment variable value
// Run this in the browser console

(function() {
  // Function to check the environment variable value
  async function checkEnvVar(varName = 'NEXT_PUBLIC_AI_RESPONSE_LOGO_SIZE') {
    console.log(`Checking environment variable: ${varName}`);
    
    // First check localStorage
    const localValue = localStorage.getItem(varName.replace('NEXT_PUBLIC_', ''));
    console.log(`Value in localStorage: ${localValue || 'not set'}`);
    
    // Check via API
    try {
      const response = await fetch(`/api/config/get-env?var=${varName}`);
      const data = await response.json();
      
      if (data.success) {
        console.log(`Value in .env.local: ${data.value}`);
        return data.value;
      } else {
        console.warn(`Could not get ${varName} from API:`, data);
        return null;
      }
    } catch (error) {
      console.error(`Error checking ${varName}:`, error);
      return null;
    }
  }
  
  // Export the utility function to the global scope
  window.checkEnvVar = checkEnvVar;
  
  console.log('Environment check utility loaded. Use checkEnvVar() in console to check variables.');
})(); 