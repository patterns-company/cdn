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
      if (!Array.isArray(data.content) || data.content.length === 0) {
        console.warn("Patterns: No valid pattern data found.");
        return;
      }

      // Process the first pattern in the response
      const pattern = data;
      if (pattern.status !== "generating" || !pattern.content) {
        console.warn("Patterns: Pattern data is not ready or missing content.");
        return;
      }

      // Define a mapping of types to attribute names
      const typeToAttribute = {
        text: "textContent",
        href: "href",
        src: "src",
        html: "innerHTML"
      };

      // Iterate over the content field and update the DOM
      pattern.content.forEach((item) => {
        const attribute = typeToAttribute[item.type];
        if (item.selector && attribute && item.payload) {
            const elements = document.querySelectorAll(item.selector);
            elements.forEach((el) => {
            if (attribute === "textContent") {
              el.textContent = item.payload;
            } else if (attribute === "innerHTML") {
              el.innerHTML = item.payload;
            } else {
              el.setAttribute(attribute, item.payload);
            }
          });
        }
      });
    })
    .catch((error) => {
      console.error("Patterns: Error fetching or processing pattern data:", error);
    });
})();