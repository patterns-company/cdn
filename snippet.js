(function () {
  const queue = window.ptrns?.q || [];
  const config = {};

  // Process queued calls
  queue.forEach((args) => {
    const [command, params] = args;
    if (command === 'init') {
      Object.assign(config, params);
    }
  });

  // Get the pattern ID from the query string
  const urlParams = new URLSearchParams(window.location.search);
  const patternIdFromQuery = urlParams.get('pattern');

  // Proceed only if pattern ID exists
  if (!patternIdFromQuery) {
    console.warn("Patterns: 'pattern' parameter is missing from the query string.");
    return;
  }

  // Define the API endpoint
  const apiEndpoint = `https://api.patterns.company/v1/pattern/${config.id}/${patternIdFromQuery}`;

  // Fetch the pattern data
  fetch(apiEndpoint)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`API request failed with status ${response.status}`);
      }
      return response.json();
    })
    .then((data) => {
      if (!Array.isArray(data) || data.length === 0) {
        console.warn("Patterns: No valid pattern data found.");
        return;
      }

      // Process the first pattern in the response
      const pattern = data[0];
      if (pattern.status !== "generating" || !pattern.content) {
        console.warn("Patterns: Pattern data is not ready or missing content.");
        return;
      }

      // Iterate over the content field and update the DOM
      pattern.content.forEach((item) => {
        if (item.selector && item.type === "text" && item.payload) {
          const elements = document.querySelectorAll(item.selector);
          elements.forEach((el) => {
            el.textContent = item.payload;
          });
        }
      });
    })
    .catch((error) => {
      console.error("Patterns: Error fetching or processing pattern data:", error);
    });
})();