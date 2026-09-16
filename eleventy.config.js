module.exports = function (eleventyConfig) {
  // CSS/JS/images ko as-is copy karo output mein
  eleventyConfig.addPassthroughCopy("src/assets");
  eleventyConfig.addPassthroughCopy("src/_redirects");
  eleventyConfig.addPassthroughCopy("src/robots.txt");

  return {
    dir: {
      input: "src",
      includes: "_includes",
      output: "_site"
    },
    // .html files bhi templates ki tarah process honge (Nunjucks front matter ke saath)
    htmlTemplateEngine: "njk"
  };
};
