/* global define:false */

'use strict';

// Wrap so that we can support different module loaders
(function(root, factory) {
  // Common JS (i.e. browserify) or Node.js environment
  if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
    module.exports = factory(require('underscore'), require('moment'));
  }
  else if (typeof define === 'function' && define.amd) {
    // AMD
    define(['underscore', 'moment'], factory);
  }
  else {
    // Brower global
    root.Timeline = factory(root._, root.moment);
  }
})(typeof window !== 'undefined' ? window : this, function(_, moment) {
  // Check depdencies
  if (typeof _ === 'undefined') {
    throw new Error('Underscore is a necessary dependency of Timeline.');
  }

  if (typeof moment === 'undefined') {
    throw new Error('Moment is a necessary dependency of Timeline.');
  }

  // Default options
  var defaultOptions = {
    // Date formates used by moment
    dateFormats: ['MMM DD, YYYY', 'MM/DD/YYYY', 'M/D/YYYY', 'DD MMM YYYY', 'YYYY-MM-DD'],

    // Date display format
    displayFormat: 'MMM DD, YYYY',

    // Put order of events in descending order (newest to oldest).  The default
    // is off, ascending (oldest to newest)
    descending: false,

    // CSV delimiting character
    csvDelimiter: ',',

    // CSV quote character
    csvQuote: '"',

    // Template.  This can be a function or string and the default will
    // be replace in the build process
    template: 'REPLACE-DEFAULT-TEMPLATE'
  };

  // Constructior
  var Timeline = function(options) {
    this.options = _.extend({}, defaultOptions, options || {});

    // Check event data
    if (!_.isArray(this.options.events) && !_.isString(this.options.events)) {
      throw new Error('"events" data should be provided as a string or array.');
    }

    // Enusre there is data
    if (_.isArray(this.options.events) && this.options.events.length < 1) {
      throw new Error('"events" data was provided as an array with no values.');
    }

    // Ensure column mapping is an object
    if (this.options.keyMapping && !_.isObject(this.options.keyMapping)) {
      throw new Error('"keyMapping" was not provided as an object.');
    }

    // Ensure there is a template
    if (!_.isString(this.options.template) && !_.isFunction(this.options.template)) {
      throw new Error('"template" was not provided as a string or function.');
    }

    // Ensure CSV chracters are single characters, not that the parsing
    // couldn't probably handle it, but why make it more complex
    if (!_.isString(this.options.csvDelimiter) || this.options.csvDelimiter.length !== 1) {
      throw new Error('"csvDelimiter" was not provided as a single chracter string.');
    }

    if (!_.isString(this.options.csvQuote) || this.options.csvQuote.length !== 1) {
      throw new Error('"csvQuote" was not provided as a single chracter string.');
    }

    // Try to build template if string
    if (_.isString(this.options.template)) {
      try {
        this.options.template = _.template(this.options.template);
      }
      catch (e) {
        throw new Error('Error parsing template string with underscore templating: ' + e.message);
      }
    }

    // Force boolean on date order
    this.options.descending = !!this.options.descending;

    // Determine if browser
    this.isBrowser = this.checkBrowser();

    // Check that element is given if in browser
    if (this.isBrowser && !this.options.el) {
      throw new Error('"el" needs to br provided as a string or object.');
    }

    // Get element
    this.el = this.getElement(this.options.el);

    // Check that an element was found if in browser
    if (this.isBrowser && !this.el) {
      throw new Error('Could not find a valid element from the given "el" option.');
    }

    // If the event data was provided as a string, attempt to parse as
    // CSV
    if (_.isString(this.options.events)) {
      this.options.events = this.parseCSV(this.options.events,
        this.options.csvDelimiter, this.options.csvQuote);
    }

    // Map columns and attach events to object for easier access.
    // Should be in format { needed: provided }
    this.events = this.mapKeys(this.options.events, this.options.keyMapping);

    // Parse events like dates
    this.events = this.parseEvents(this.events);

    // Group events.
    this.groups = this.groupEvents(this.events);

    // Sort groups
    this.groups = this.sortGroups(this.groups, this.options.descending);

    // Render if browser
    if (this.isBrowser) {
      this.render();
    }
  };

  // Add methods
  _.extend(Timeline.prototype, {
    // Main renderer
    render: function() {
      this.el.innerHTML = this.options.template({
        _: _,
        groups: this.groups,
        title: this.options.title,
        timeline: this
      });
    },

    // Get element from some sort of selector or element.  Inspiration
    // from Ractive
    getElement: function(input) {
      var output;

      // Check if we are in a brower
      if (!this.isBrowser || !input) {
        return null;
      }

      // We already have a DOM node - no work to do.
      if (input.nodeType) {
        return input;
      }

      // Get node from string
      if (typeof input === 'string') {
        // try ID first
        output = document.getElementById(input);

        // then as selector, if possible
        if (!output && document.querySelector) {
          output = document.querySelector(input);
        }

        // Did it work?
        if (output && output.nodeType) {
          return output;
        }
      }

      // If we've been given a collection (jQuery, Zepto etc),
      // extract the first item
      if (input[0] && input[0].nodeType) {
        return input[0];
      }

      return null;
    },

    // Simple test for browser (used mostly for testing in Node)
    checkBrowser: function() {
      return (typeof window !== 'undefined' && document);
    },

    // Sort groups (and events in groups).  Sorts ascending (oldest to newest)
    // by default, but can do descending.
    sortGroups: function(groups, descending) {
      descending = descending || false;

      // Sort events
      groups = _.map(groups, function(g) {
        g.events = _.sortBy(g.events, function(e) {
          return e.date.unix() * ((descending) ? -1 : 1);
        });

        return g;
      });

      // Sort groups
      return _.sortBy(groups, function(g) {
        return g.date.unix() * ((descending) ? -1 : 1);
      });
    },

    // Group events based on grouping function.  A grouping function
    // should take an event and return an object with the following
    // properties: `id`, `date`, `display` (as moment object)
    groupEvents: function(events) {
      var groups = {};
      var groupByFunc;

      // Determine group
      this.groupType = this.determineGroups(this.events);

      // Get grouping function
      groupByFunc = 'groupBy' + this.groupType.charAt(0).toUpperCase() +
        this.groupType.slice(1);
      groupByFunc = this[groupByFunc];

      // Go through each event and create or add to group
      _.each(events, function(e) {
        var g = _.bind(groupByFunc, this)(e, moment);

        if (groups[g.id]) {
          groups[g.id].events.push(e);
        }
        else {
          groups[g.id] = g;
          groups[g.id].events = [e];
        }
      });

      return _.values(groups);
    },

    // Group by for months
    groupByMonths: function(event, moment) {
      return {
        id: event.date.format('YYYY-MM'),
        date: moment(event.date.format('YYYY-MM'), 'YYYY-MM'),
        display: moment(event.date.format('YYYY-MM'), 'YYYY-MM').format('MMM, YYYY')
      };
    },

    // Group by for years
    groupByYears: function(event, moment) {
      return {
        id: event.date.format('YYYY'),
        date: moment(event.date.format('YYYY'), 'YYYY'),
        display: moment(event.date.format('YYYY'), 'YYYY').format('YYYY')
      };
    },

    // Group by for decades
    groupByDecades: function(event, moment) {
      var decade = Math.floor(event.date.year() / 10) * 10;
      return {
        id: decade.toString(),
        date: moment(decade.toString(), 'YYYY'),
        display: moment(decade.toString(), 'YYYY').format('YYYY\'s')
      };
    },

    // Determine groups
    determineGroups: function(events) {
      // Some functions
      var getDate = function(e) { return e.date.unix(); };

      // Determine span and grouping
      var min = _.min(events, getDate);
      var max = _.max(events, getDate);
      var diff = max.date.diff(min.date, 'years');

      return (diff < 2) ? 'months' :
        (diff < 10) ? 'years' : 'decades';
    },

    // Parse events
    parseEvents: function(events) {
      return _.map(events, _.bind(function(e) {
        // Parse date
        var d = moment(e.date, this.options.dateFormats);
        if (!d.isValid()) {
          throw new Error('Error parsing date from "' + e.date + '"');
        }

        e.date = d;

        // Determine type of media from media url if mediaType has not
        // been provided
        e.mediaType = e.mediaType || this.determineMediaType(e.media);

        // Create a formatted version of date for template
        e.dateFormatted = d.format(this.options.displayFormat);

        return e;
      }, this));
    },

    // Given a URL, determine how to handle it.  The default is treat
    // the URL as an image, otherwise
    determineMediaType: function(url) {
      // None
      if (!url) {
        return undefined;
      }

      // Youtube
      else if (url.indexOf('youtube.com') !== -1) {
        return 'youtube';
      }

      // SoundCloud larger/visual
      else if (url.indexOf('soundcloud.com') !== -1 && url.indexOf('visual=true') !== -1) {
        return 'soundcloud_large';
      }

      // SoundCloud regular
      else if (url.indexOf('soundcloud.com') !== -1) {
        return 'soundcloud';
      }

      // Image
      else {
        return 'image';
      }
    },

    // Map columns
    mapKeys: function(events, mapping) {
      mapping = mapping || {};

      // Go through each event, clone, change mappings, and remove old
      return _.map(events, function(e) {
        var n = _.clone(e);

        // Find a mapping
        _.each(mapping, function(m, mi) {
          if (!_.isUndefined(e[m]) && m !== mi) {
            n[mi] = _.clone(e[m]);
            delete n[m];
          }
        });

        return n;
      });
    },

    // This will parse a csv string into an array of array.  Default
    // delimiter is a comma and quote character is double quote
    //
    // Inspired from: http://stackoverflow.com/a/1293163/2343
    parseCSV: function(csv, delimiter, quote) {
      delimiter = delimiter || ',';
      quote = quote || '"';
      var d = this.regexEscape(delimiter);
      var q = this.regexEscape(quote);

      // Remove any extra line breaks
      csv = csv.replace(/^\s+|\s+$/g, '');

      // Regular expression to parse the CSV values.
      var pattern = new RegExp((

        // Delimiters.
        '(' + d + '|\\r?\\n|\\r|^)' +

        // Quoted fields.
        '(?:' + q + '([^' + q + ']*(?:' + q + q + '[^' + q + ']*)*)' + q + '|' +

        // Standard fields.
        '([^' + q + '' + d + '\\r\\n]*))'
      ), 'gi');

      // For holding match data
      var parsed = [[]];
      var matches = pattern.exec(csv);

      // For getting properties
      var headers;

      // Keep looping over the regular expression matches
      // until we can no longer find a match.
      while (matches) {
        var matchedDelimiter = matches[1];
        var matchedValue;

        // Check to see if the given delimiter has a length
        // (is not the start of string) and if it matches
        // field delimiter. If id does not, then we know
        // that this delimiter is a row delimiter.
        if (matchedDelimiter.length && matchedDelimiter !== delimiter) {
          // Since we have reached a new row of data,
          // add an empty row to our data array.
          parsed.push([]);
        }

        // Now that we have our delimiter out of the way,
        // let's check to see which kind of value we
        // captured (quoted or unquoted).
        if (matches[2]) {
          // We found a quoted value. When we capture
          // this value, reduce any double occurences to one.
          matchedValue = matches[2].replace(new RegExp('' + q + q, 'g'), q);
        }
        else {

          // We found a non-quoted value.
          matchedValue = matches[3];
        }

        // Now that we have our value string, let's add
        // it to the data array.
        parsed[parsed.length - 1].push(matchedValue.trim());

        // Try it again
        matches = pattern.exec(csv);
      }

      // Check that we found some data
      if (parsed.length <= 1 || !parsed[0].length) {
        throw new Error('Unable to parse any data from the CSV string provided.');
      }

      // Put together with properties from first row
      headers = parsed.shift();
      parsed = _.map(parsed, function(p) {
        var n = {};

        _.each(headers, function(h, hi) {
          n[h] = p[hi];
        });

        return n;
      });

      return parsed;
    },

    // Escape special regex character
    regexEscape: function(input) {
      return input.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
    }
  });

  return Timeline;
});
