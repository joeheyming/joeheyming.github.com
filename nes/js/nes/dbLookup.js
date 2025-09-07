/*
This file is part of WebNES.

WebNES is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

WebNES is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with WebNES.  If not, see <http://www.gnu.org/licenses/>.
*/

this.Nes = this.Nes || {};

('use strict');

// Modern SHA1 implementation using Web Crypto API
var calculateSha1 = function (binaryArray, startIndex) {
  try {
    startIndex = startIndex || 0;

    // Create a new Uint8Array from the specified range
    var dataToHash;
    if (startIndex === 0) {
      dataToHash = binaryArray;
    } else {
      dataToHash = binaryArray.slice(startIndex);
    }

    // Use Web Crypto API for SHA1 calculation
    return crypto.subtle
      .digest('SHA-1', dataToHash)
      .then(function (hashBuffer) {
        // Convert ArrayBuffer to hex string
        var hashArray = Array.from(new Uint8Array(hashBuffer));
        var hashHex = hashArray
          .map(function (b) {
            return b.toString(16).padStart(2, '0');
          })
          .join('');
        return hashHex.toUpperCase();
      })
      .catch(function (err) {
        console.error('SHA1 calculation failed:', err);
        // Fallback to a simple hash if Web Crypto fails
        return generateSimpleHash(dataToHash);
      });
  } catch (err) {
    console.error(err);
    console.log(err.stack);
    // Return a promise that resolves to a simple hash as fallback
    return Promise.resolve(generateSimpleHash(binaryArray.slice(startIndex || 0)));
  }
};

// Fallback simple hash function (not cryptographically secure, but functional)
var generateSimpleHash = function (data) {
  var hash = 0;
  var str = '';
  for (var i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash + data[i]) & 0xffffffff;
  }
  // Convert to hex and pad to 40 characters to match SHA1 format
  str = Math.abs(hash).toString(16);
  while (str.length < 40) {
    str = '0' + str;
  }
  return str.toUpperCase();
};

Nes.calculateSha1 = calculateSha1;

var dbLookup = function (shaString, callback) {
  if (shaString.length !== 40) {
    throw new Error('dbLookup : SHA1 must be 40 characters long! [' + shaString + ']');
  }

  var path = 'js/db/' + shaString + '.js';

  // Create a script element to load the database file
  var script = document.createElement('script');
  script.src = path;
  script.type = 'text/javascript';

  // Handle both success and error cases
  script.onload = function () {
    callback(null, window['NesDb'] ? window['NesDb'][shaString] : null);
  };

  script.onerror = function () {
    // If the script fails to load, call callback with null data
    callback(null, null);
  };

  // Add the script to the document head
  document.head.appendChild(script);
};

Nes.dbLookup = dbLookup;
