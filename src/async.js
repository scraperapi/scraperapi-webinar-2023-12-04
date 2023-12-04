/**
 * Purpose: Gather "Air Fryer" product information, offers and reviews from Amazon using
 * the scraperapi async API.
 */

const axios = require('axios');
const wait = require('wait');

const API_KEY = ''; // Your API Key Here.
const DELAY = 2000;

/**
 * Polls a job status endpoint until it's done.
 *
 * @param {object} job 
 */
const pollJob = async(url) => {
  let job = await axios({ url });
  while (job.data.status === 'running') {
    await wait(DELAY);
    job = await axios({
      url: job.data.statusUrl
    });
  }
  return job.data.response?.body;
};

/**
 * Submit a job to the scraperapi async API and poll the status endpoint until the job is complete.
 * @param object data 
 * @param string url 
 */
const submitJob = async(data, url) => {
  const response = await axios({
    data,
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    url
  });

  await wait(DELAY);

  // When we submit a single job we get a single response back and can
  // poll the status URL endpoint for the job's status, until the job
  // is complete.  When we submit a batch job, we get a list of jobs
  // back and must poll them individually.

  if (Array.isArray(response.data)) {
    const results = [];
    const promises = [];
    for (const job of response.data) {
      if (job.status === 'running') {
        promises.push(new Promise((resolve, reject) => {
          pollJob(job.statusUrl)
            .then(result => {
              results.push(result);
              return resolve();
            }).catch(err => {
              return reject(err);
            });
        }));
      }
    }
    await Promise.all(promises);
    return results;
  } else {
    return pollJob(response.data.statusUrl);
  }
};

(async() => {
  try {
    // Submit a search request to the scraperapi amazon search async endpoint.
    const response = await submitJob({
      apiKey: API_KEY,
      query: 'Air+Fryer'
    }, 'https://async.scraperapi.com/structured/amazon/search');

    const promises = [];

    // At this point, we should have the results of the search,
    // so can go on to scrape each product page in a single batch job.
    const asins = response.results.map(result => result.asin);
    let products;
    let offers;
    let reviews;

    // Retrieve product details.
    promises.push(new Promise((resolve, reject) => {
      submitJob({
        apiKey: API_KEY,
        asins
      }, 'https://async.scraperapi.com/structured/amazon/product')
        .then(response => {
          products = response;
          return resolve();
        }).catch(err => {
          return reject(err);
        });
    }));

    // Retrieve offers for the same products.
    promises.push(new Promise((resolve, reject) => {
      offers = submitJob({
        apiKey: API_KEY,
        asins
      }, 'https://async.scraperapi.com/structured/amazon/offers')
        .then(response => {
          offers = response;
          return resolve();
        }).catch(err => {
          return reject(err);
        });
    }));

    // And finally retrieve reviews for the same products.
    promises.push(new Promise((resolve, reject) => {
      reviews = submitJob({
        apiKey: API_KEY,
        asins
      }, 'https://async.scraperapi.com/structured/amazon/review')
        .then(response => {
          reviews = response;
          return resolve();
        }).catch(err => {
          return reject(err);
        });
    }));

    await Promise.all(promises);

    // Now we have all the data we need, save it to a file or database.
    // ...

    console.log('Done!');
  } catch (err) {
    console.error(err);
  }
})();