/**
 * Purpose: Search Amazon for a list of products and scrape product details.
 */

const axios = require('axios');
const cheerio = require('cheerio');
const wait = require('wait');

const API_KEY = ''; // Your API key here.
const MAX_CONCURRENCY = 5;

let currentRequests = 0;

/**
 * Given an asin, this function will scrape the product details, offers and reviews from Amazon.
 * @param {string} asin 
 */
const getProduct = async(asin) => {
  let retries = 0;
  let productDetails;
  const product = {};

  while (retries < 5) {
    retries += 1;
    try {
      // Make sure we don't exceed our account's concurrency limit.
      while (currentRequests >= MAX_CONCURRENCY) {
        await wait(200);
      }
      currentRequests += 1;
      productDetails = await axios.get(`https://api.scraperapi.com/structured/amazon/product/?api_key=${API_KEY}&asin=${asin}`);
      break;
    } catch (err) {
      console.error(err);
    } finally {
      currentRequests -= 1;
    }
  }

  if (retries === 5) {
    throw new Error(`Failed to fetch from Amazon for ${asin}`);
  }

  if (productDetails.data) {
    product.details = productDetails.data;
  }

  // Scrape product offers from Amazon.
  retries = 0;
  let offers;
  while (retries < 5) {
    retries += 1;
    // Make sure we don't exceed our account's concurrency limit.
    while (currentRequests >= MAX_CONCURRENCY) {
      await wait(200);
    }
    try {
      currentRequests += 1;
      offers = await axios.get(`https://api.scraperapi.com/structured/amazon/offers?api_key=${API_KEY}&asin=${asin}`);
      break;
    } catch (err) {
      if (err.response?.status === 404) {
        // No offers found.
        break;
      }
      console.error(err);
    } finally {
      currentRequests -= 1;
    }
  }

  if (retries === 5) {
    throw new Error(`Failed to fetch from Amazon Offers for ${asin}`);
  }

  if (offers?.data) {
    product.offers = offers.data;
  }

  // Scrape product reviews from Amazon.
  // ...

  return product;
}

(async() => {

  // Scrape "Air Fryer" search results from Amazon, retrying up to 5 times in the unlikely event of failure.
  let retries = 0;
  let searchResults;
  const products = [];

  while (retries < 5) {
    retries += 1;
    try {
      searchResults = await axios.get(`https://api.scraperapi.com/structured/amazon/search/?api_key=${API_KEY}&query=Air+Fryer`);
      break;
    } catch (err) {
      console.error(err);
    }
  }

  if (retries === 5) {
    console.error('Failed to fetch from Amazon');
    return;
  }

  // Scrape each page in the pagination details we get from our search.
  searchResults.pagination.forEach(async(page) => {
    // ...
  });

  // Now we have the products we searched for in a convenient JSON object, we can scrape each individual
  // product page for more details.
  const promises = [];
  searchResults.data.results.forEach(async(result) => {
    promises.push(new Promise((resolve, reject) => getProduct(result.asin)
      .then(product => {
        products.push(product);
        return resolve();
      }).catch(err => {
        return reject(err)
      })
    ));
  });

  await Promise.all(promises);

  // Save scraped data to the database.

  console.log('Done!');
}) ();
