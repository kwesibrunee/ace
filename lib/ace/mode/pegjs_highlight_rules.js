define(function (require, exports, module) {
  "use strict";

  var oop = require("ace/lib/oop");
  var TextHighlightRules = require("ace/mode/text_highlight_rules").TextHighlightRules;
  var JavaScriptHighlightRules = require("ace/mode/javascript_highlight_rules").JavaScriptHighlightRules;

  var PegjsHighlightRules = function () {

    this.$rules = {

      'start': [
        {
          token: 'identifier',
          regex: '[a-zA-Z][a-zA-Z0-9]+'
        },
        {
          token: 'string',
          regex: '["](?:(?:\\\\.)|(?:[^"\\\\]))*?["]'
        },
        {
          token: 'keyword.operator',
          regex: '[=/](?!/)',
          next : 'peg-rule'
        },
        {
          token: 'comment',
          regex: '[//].*'
        }
      ],

      'peg-rule': [
        {
          token: "text",
          regex: "(?=[a-zA-Z][a-zA-Z0-9]+\\S*=)",
          next: "start"
        },
        {
          token: 'string',
          regex: '["](?:(?:\\\\.)|(?:[^"\\\\]))*?["]'
        },
        {
          token: 'string',
          regex: "['](?:(?:\\\\.)|(?:[^'\\\\]))*?[']"
        },
        {
          token: 'keyword.operator',
          regex: '[=]',
        },
        {
          token: ['variable', "keyword.operator"],
          regex: '([a-zA-Z][a-zA-Z0-9]+)(:)'
        },
        {
          token: 'string',
          regex: '\\[(?:(?:\\\\.)|(?:[^\\]\\\\]))*?\\]'
        },
        {
          token: 'identifier',
          regex: '[a-zA-Z][a-zA-Z0-9]+'
        },
        {
          token: 'keyword.operator',
          regex: '(?:[+?*()]|/(?!/))'
        },
        {
          token: 'keyword',
          regex: '{',
          next : 'js-start'
        },
        {
          token: 'comment',
          regex: '[//].*'
        }
      ]

    };

    for (var i in this.$rules) {
      this.$rules[ i ].unshift({
        token: 'comment',
        regex: '/\\*',
        next : 'comment'
      });
    }

    this.$rules.comment = [
      {
        token: 'comment',
        regex: '\\*/',
        next : 'start'
      },
      {
        token: 'comment',
        regex: '.'
      }
    ];

    this.embedRules(JavaScriptHighlightRules, 'js-', [
      { token: 'keyword', regex: '}', next: 'start' }
    ]);

  };

  oop.inherits(PegjsHighlightRules, TextHighlightRules);
  exports.PegjsHighlightRules = PegjsHighlightRules;

});
