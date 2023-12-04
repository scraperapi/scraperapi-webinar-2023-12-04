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
  while (retries < 5) {
    retries += 1;
    try {
      // Make sure we don't exceed our account's concurrency limit.
      while (currentRequests >= MAX_CONCURRENCY) {
        await wait(200);
      }
      currentRequests += 1;
      productDetails = await axios.get(`https://api.scraperapi.com/?api_key=${API_KEY}&url=https://www.amazon.com/dp/${asin}`);
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

  // Load the product details raw HTML into Cheerio and extract the product details.
  let $$ = cheerio.load(productDetails.data, { _useHtmlParser2: true });
  const product = {
    details: { asin },
    offers: [],
    reviews: []
  };
  product.details.description = $$('div#productDescription').text();
  product.details.dimensions = $$('div#detail-bullets').find('li:contains("Product Dimensions")').text();
  product.details.weight = $$('div#detail-bullets').find('li:contains("Item Weight")').text();
  product.details.bestSellersRank = $$('div#detail-bullets').find('li:contains("Best Sellers Rank")').text();
  product.details.manufacturer = $$('div#detail-bullets').find('li:contains("Manufacturer")').text();

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
      const url = `https://www.amazon.com/gp/offer-listing/${asin}/ref=dp_olp_ALL_mbc?ie=UTF8&condition=ALL`
      offers = await axios.get(`https://api.scraperapi.com/?api_key=${API_KEY}&url=${encodeURIComponent(url)}`);
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
    $$ = cheerio.load(offers.data, { _useHtmlParser2: true }); 
    // ...
  }

  // Scrape product reviews from Amazon.
  // ...

  return product;
}

(async() => {

  // Scrape "Air Fryer" search results from Amazon, retrying up to 5 times in the unlikely event of failure.
  let retries = 0;
  let searchResults;
  const asins = [];
  const products = [];

  while (retries < 5) {
    retries += 1;
    try {
      searchResults = await axios.get(`https://api.scraperapi.com/?api_key=${API_KEY}&url=https://www.amazon.com/s?k=Air+Fryer`);
      break;
    } catch (err) {
      console.error(err);
    }
  }

  if (retries === 5) {
    console.error('Failed to fetch from Amazon');
    return;
  }

  try {
    // Load the search results raw HTML into Cheerio and extract the product details.  This is an
    // extremely simplified example and does not, for example, handle pagination or product detail.
    const $ = cheerio.load(searchResults.data, { _useHtmlParser2: true }); // eslint-disable-line id-length
    $('div[data-asin]').each((index, element) => {
      if ($(element).attr('data-asin') !== '') {
        asins.push($(element).attr('data-asin'));
      }
    });
  } catch (err) {
    console.error(err);
    return;
  }

  // Now we have the products we searched for, we can scrape each individual product page for more details.
  const promises = [];
  asins.forEach(async(asin) => {
    promises.push(new Promise((resolve, reject) => getProduct(asin)
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
