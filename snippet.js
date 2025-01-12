(function () {
  const queue = window.ptns.q || [];
  const config = {};

  // Process queued calls
  queue.forEach((args) => {
    const [command, params] = args;
    if (command === 'init') {
      Object.assign(config, params);
    }
  });

  // Ensure the required ID is available
  if (!config.id) {
    console.error("Ptns: 'id' parameter is required during initialization.");
    return;
  }

  // Define the API endpoint
  const apiEndpoint = `https://api.patterns.company/v1/pattern/${config.id}`;

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
        console.warn("Ptns: No valid pattern data found.");
        return;
      }

      // Process the first pattern in the response
      const pattern = data[0];
      if (pattern.status !== "generating" || !pattern.content) {
        console.warn("Ptns: Pattern data is not ready or missing content.");
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
      console.error("Ptns: Error fetching or processing pattern data:", error);
    });
})();