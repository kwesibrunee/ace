/* ***** BEGIN LICENSE BLOCK *****
 * Distributed under the BSD license:
 *
 * Copyright (c) 2010, Ajax.org B.V.
 * All rights reserved.
 * 
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *     * Redistributions of source code must retain the above copyright
 *       notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above copyright
 *       notice, this list of conditions and the following disclaimer in the
 *       documentation and/or other materials provided with the distribution.
 *     * Neither the name of Ajax.org B.V. nor the
 *       names of its contributors may be used to endorse or promote products
 *       derived from this software without specific prior written permission.
 * 
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL AJAX.ORG B.V. BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * ***** END LICENSE BLOCK ***** */

define(function(require, exports, module) {
    "use strict";

    var oop = require("../lib/oop");
    var Mirror = require("../worker/mirror").Mirror;
    var peg = require("../mode/pegjs/peg-0.9.0.js");
    var pegast = require("../mode/pegjs/pegast.js");
    window.addEventListener = function() {};

    var lint = require("./javascript/jshint").JSHINT;

    function startRegex(arr) {
        return new RegExp("^(" + arr.join("|") + ")");
    }

    var disabledWarningsRe = startRegex([
        "Bad for in variable '(.+)'.",
        'Missing "use strict"'
    ]);
    var errorsRe = startRegex([
        "Unexpected",
        "Expected ",
        "Confusing (plus|minus)",
        "\\{a\\} unterminated regular expression",
        "Unclosed ",
        "Unmatched ",
        "Unbegun comment",
        "Bad invocation",
        "Missing space after",
        "Missing operator at",
        ".*in strict mode.$",
        "Duplicate key"
    ]);
    var infoRe = startRegex([
        "Expected an assignment",
        "Bad escapement of EOL",
        "Unexpected comma",
        "Unexpected space",
        "Missing radix parameter.",
        "A leading decimal point can",
        "\\['{a}'\\] is better written in dot notation.",
        "'{a}' used out of scope"
    ]);

    var visitor = {
        build: function(functions) {
            function visit(node) {
                if (functions[node.type]) {
                    return functions[node.type].apply(null, arguments);
                }
                else {
                    return DEFAULT_FUNCTIONS[node.type].apply(null, arguments);
                }
            }

            function visitNop() {

            }

            function visitExpression(node) {
                var extraArgs = Array.prototype.slice.call(arguments, 1);
                visit.apply(null, [node.expression].concat(extraArgs));
            }

            function visitChildren(property) {
                return function(node) {
                    var extraArgs = Array.prototype.slice.call(arguments, 1);
                    for (var x = 0; x < node[property].length; x++) {
                        var child = node[property][x];
                        node[property][x] = visit.apply(null, [child].concat(extraArgs));
                    }
                    return node;
                };
            }

            var DEFAULT_FUNCTIONS = {
                grammar: function(node) {
                    var extraArgs = Array.prototype.slice.call(arguments, 1);

                    if (node.initializer) {
                        node.initializer = visit.apply(null, [node.initializer].concat(extraArgs));
                    }
                    for (var x = 0; x < node.rules.length; x++) {
                        var rule = node.rules[x];
                        visit.apply(null, [rule].concat(extraArgs));
                    }
                    //console.log(node);
                    return node;
                },

                initializer: visitNop,
                rule: visitExpression,
                named: visitExpression,
                choice: visitChildren("alternatives"),
                action: visitExpression,
                sequence: visitChildren("elements"),
                labeled: visitExpression,
                text: visitExpression,
                simple_and: visitExpression,
                simple_not: visitExpression,
                optional: visitExpression,
                zero_or_more: visitExpression,
                one_or_more: visitExpression,
                semantic_and: visitNop,
                semantic_not: visitNop,
                rule_ref: visitNop,
                literal: visitNop,
                "class": visitNop,
                any: visitNop
            };
            return visit;
        }
    };



    function eachCode(ast, input) {
        var check = visitor.build({
                grammar: function(node) {
                    node.rules.forEach(check);
                    return node;
                },
                rule: function(node) {
                    check(node.expression, {
                        env: {}, // mapping of label names to location
                    });
                },
                named: function(node, context) {
                    check(node.expression, context);
                },

                choice: function(node, context) {
                    node.alternatives.forEach(function(alternative) {
                        check(alternative, {
                            env: JSON.parse(JSON.stringify(context.env))
                        });
                    });
                },
                action: function(node, context) {
                    var env = JSON.parse(JSON.stringify(context.env));
                    check(node.expression, {
                        env: env
                    });
                    node.$labelsInScope = Object.getOwnPropertyNames(env);
                },
                sequence: function(node, context) {
                    node.elements.forEach(function(element) {
                        check(element, {
                            env: context.env
                        });
                    });
                },
                labeled: function(node, context) {
                    var env = JSON.parse(JSON.stringify(context.env));
                    context.env[node.label] = node.location;
                    check(node.expression, {
                        env: env
                    });
                },
                text: function(node, context) {
                    var env = JSON.parse(JSON.stringify(context.env));
                    check(node.expression, {
                        env: env
                    });
                },
                simple_not: function(node, context) {
                    var env = JSON.parse(JSON.stringify(context.env));
                    check(node.expression, {
                        env: env
                    });
                },
                simple_and: function(node, context) {
                    var env = JSON.parse(JSON.stringify(context.env));
                    check(node.expression, {
                        env: env
                    });
                },
                optional: function(node, context) {
                    var env = JSON.parse(JSON.stringify(context.env));
                    check(node.expression, {
                        env: env
                    });
                },
                zero_or_more: function(node, context) {
                    var env = JSON.parse(JSON.stringify(context.env));
                    check(node.expression, {
                        env: env
                    });
                },
                one_or_more: function(node, context) {
                    var env = JSON.parse(JSON.stringify(context.env));
                    check(node.expression, {
                        env: env
                    });
                },
                semantic_not: function(node, context) {
                    node.$labelsInScope = Object.getOwnPropertyNames(context.env);
                },
                semantic_and: function(node, context) {
                    node.$labelsInScope = Object.getOwnPropertyNames(context.env);
                },
            });
        ast = check(ast);
        var initializer = "";

        function nodeSource(node) {
            return input.slice(node.location.start.offset, node.location.end.offset);
        }

        function eachNode(node, callback, parent) {
            callback(node, parent || null);
            var children = node.alternatives || node.elements || node.rules;
            if (children) {
                children.forEach(function(child) {
                    eachNode(child, callback, node);
                });
            }
            else if (node.expression) {
                eachNode(node.expression, callback, node);
            }
        }
        var javascript = "",
            currentline = 1,
            currentcolumn = 0,
            currentOffset = 0;

        if (ast.initializer) {
            initializer = ast.initializer;
            javascript = (new Array(initializer.location.start.line).join("\n")) + initializer.code + "\n";
            currentline = initializer.location.end.line;
            currentcolumn = initializer.location.end.column;
            currentOffset = initializer.location.end.offset;
        }
        var counter = 0,
            nodes = [];
        ast.rules.forEach(function(rule) {
            eachNode(rule.expression, function(node, parent) {
                if ("code" in node) {
                    nodes.push([node, parent]);
                }
            }, rule);
        });
        nodes.sort(function(a, b) {
            var node1 = a[0];
            var node2 = b[0];
            var codeOffset1 = nodeSource(node1).indexOf(node1.code);
            var codeOffset2 = nodeSource(node2).indexOf(node2.code);
            return (node1.location.start.offset + codeOffset1) - (node2.location.start.offset + codeOffset2);
        });
        nodes.forEach(function(p) {
            var node = p[0];
            var parent = p[1];
            var re = /("\r\n"|[\r\n\u2028\u2029])/g;
            var codeOffset = nodeSource(node).indexOf(node.code);
            var match = nodeSource(node).slice(0, codeOffset).match(re);
            var lines = (match !== null) ? match.length : 0;
            var codeStartLine = node.location.start.line + lines;
            var codeStartColumn;
            var result = re.exec(nodeSource(node).slice(0, codeOffset));
            if (result && re.lastIndex !== -1) {
                codeStartColumn = nodeSource(node).slice(re.lastIndex, codeOffset).length;
            }
            else {
                codeStartColumn = node.location.start.column + nodeSource(node).slice(0, codeOffset).length;
            }
            match = nodeSource(ast).slice(currentOffset, node.location.start.offset + codeOffset).match(re);
            lines = (match !== null) ? match.length + 1 : 0;
            var temp = "function l$l" + counter + " (" + node.$labelsInScope.join(",") + "){";
            if (temp.length <= codeStartColumn) {
                javascript += new Array(lines).join("\n");
                javascript += temp;
                javascript += new Array(codeStartColumn - temp.length).join(" ");
            }
            else if (lines > 0) {
                javascript += new Array(lines - 1).join("\n");
                javascript += temp + "\n";
                javascript += new Array(codeStartColumn).join(" ");
            }
            else {
                javascript += temp;
                javascript += new Array(lines).join("\n");
                javascript += new Array(codeStartColumn).join(" ");
            }
            javascript += node.code;
            javascript += "}l$l" + counter + ".t=true;";
            counter++;
            currentOffset = node.location.start.offset + codeOffset + node.code.length;
        });
        return javascript;
    }

    var Worker = exports.Worker = function(sender) {
        Mirror.call(this, sender);
        this.setTimeout(500);
        this.setOptions();
    };

    oop.inherits(Worker, Mirror);

    (function() {
        this.setOptions = function(options) {
            this.options = options || {
                undef: true,
                esnext: true,
                moz: true,
                devel: true,
                browser: true,
                node: true,
                laxcomma: true,
                laxbreak: true,
                lastsemic: true,
                onevar: false,
                passfail: false,
                maxerr: 100000,
                expr: true,
                multistr: true,
                globalstrict: true,
                predef: ["text", "location", "error", "expected"]
            };
            this.doc.getValue() && this.deferredUpdate.schedule(100);
        };

        this.changeOptions = function(newOptions) {
            oop.mixin(this.options, newOptions);
            this.doc.getValue() && this.deferredUpdate.schedule(100);
        };
        this.isValidJS = function(str) {
            try {
                // evaluated code can only create variables in this function
                eval("throw 0;" + str);
            }
            catch (e) {
                if (e === 0)
                    return true;
            }
            return false;
        };
        this.onUpdate = function() {
            var value = this.doc.getValue();

            var ret;
            var errors = [];
            try {
                var temp = peg.buildParser(value);
            }
            catch (e) {
                if (e.location) {
                    errors.push({
                        row: e.location.start.line - 1,
                        column: e.location.start.column,
                        text: wordwrap(e.message, 75),
                        type: "error",
                        raw: ""
                    });
                    return this.sender.emit("annotate", errors);
                }
            }
            ret = pegast.parse(value);
            // JSHINT
            value = eachCode(ret, value);

            //value = value.replace(/^#!.*\n/, "\n");
            if (!value)
                return this.sender.emit("annotate", []);
            // Add unused rule and duplicate rule detection
            var rules = {};
            var rulesReferenced = {};
            var first;
            var check = visitor.build({
                grammar: function(node) {
                    node.rules.forEach(check);
                    return node;
                },
                rule: function(node) {
                    if (rules[node.name]) {
                        errors.push({
                            row: node.location.start.line - 1,
                            column: node.location.start.column - 1,
                            text: "rule " + node.name + " is already defined on line " + rules[node.name].location.start.line,
                            type: "warning"
                        });
                    }
                    else {
                        rules[node.name] = {
                            name: node.name,
                            location: node.location
                        };
                    }
                    if (!first) {
                        first = node.name;
                    }
                    check(node.expression, {
                        env: {}, // mapping of label names to location
                    });
                },
                named: function(node, context) {
                    check(node.expression, context);
                },

                choice: function(node, context) {
                    node.alternatives.forEach(function(alternative) {
                        check(alternative, {
                            env: JSON.parse(JSON.stringify(context.env))
                        });
                    });
                },
                action: function(node, context) {
                    var env = JSON.parse(JSON.stringify(context.env));
                    check(node.expression, {
                        env: env
                    });
                    node.context = JSON.parse(JSON.stringify({env:env}));
                },
                sequence: function(node, context) {
                    node.elements.forEach(function(element) {
                        check(element, {
                            env: context.env
                        });
                    });
                },
                labeled: function(node, context) {
                    var env = JSON.parse(JSON.stringify(context.env));
                    if (context.env[node.label] !== undefined) {
                        errors.push({
                            row: node.location.start.line - 1,
                            column: node.location.start.column - 1,
                            text: "label " + node.label + " is already defined in this scope on line " + context.env[node.label].start.line,
                            type: "warning"
                        });
                    }
                    else {
                        context.env[node.label] = node.location;
                    }
                    check(node.expression, {
                        env: env
                    });
                },
                text: function(node, context) {
                    var env = JSON.parse(JSON.stringify(context.env));
                    check(node.expression, {
                        env: env
                    });
                },
                simple_not: function(node, context) {
                    var env = JSON.parse(JSON.stringify(context.env));
                    check(node.expression, {
                        env: env
                    });
                },
                simple_and: function(node, context) {
                    var env = JSON.parse(JSON.stringify(context.env));
                    check(node.expression, {
                        env: env
                    });
                },
                optional: function(node, context) {
                    var env = JSON.parse(JSON.stringify(context.env));
                    check(node.expression, {
                        env: env
                    });
                },
                zero_or_more: function(node, context) {
                    var env = JSON.parse(JSON.stringify(context.env));
                    check(node.expression, {
                        env: env
                    });
                },
                one_or_more: function(node, context) {
                    var env = JSON.parse(JSON.stringify(context.env));
                    check(node.expression, {
                        env: env
                    });
                },
                semantic_not: function(node, context) {
                    node.context = JSON.parse(JSON.stringify(context));
                },
                semantic_and: function(node, context) {
                    node.context = JSON.parse(JSON.stringify(context));
                },
                rule_ref: function(node) {
                    if (rulesReferenced[node.name]) {
                        rulesReferenced[node.name].referenced = true;
                    }
                    else {
                        rulesReferenced[node.name] = {
                            name: node.name,
                            referenced: true
                        };
                    }
                },
            });
            ret = check(ret);

            for (var ruleName in rules) {
                if (ruleName !== first && !rulesReferenced[ruleName]) {
                    errors.push({
                        row: rules[ruleName].location.start.line - 1,
                        column: rules[ruleName].location.start.column - 1,
                        text: "rule " + rules[ruleName].name + " is defined but never referenced",
                        type: "info"
                    });
                }
            }
            //console.log(rules);
            // jshint reports many false errors
            // report them as error only if code is actually invalid
            var maxErrorLevel = this.isValidJS(value) ? "warning" : "error";

            // var start = new Date();
            lint(value, this.options);
            var results = lint.errors;

            var errorAdded = false;
            for (var i = 0; i < results.length; i++) {
                var error = results[i];
                if (!error)
                    continue;
                var raw = error.raw;
                var type = "warning";

                if (raw == "Missing semicolon.") {
                    var str = error.evidence.substr(error.character);
                    str = str.charAt(str.search(/\S/));
                    if (maxErrorLevel == "error" && str && /[\w\d{(['"]/.test(str)) {
                        error.reason = 'Missing ";" before statement';
                        type = "error";
                    }
                    else {
                        type = "info";
                    }
                }
                else if (disabledWarningsRe.test(raw)) {
                    continue;
                }
                else if (infoRe.test(raw)) {
                    type = "info";
                }
                else if (errorsRe.test(raw)) {
                    errorAdded = true;
                    type = maxErrorLevel;
                }
                else if (raw == "'{a}' is not defined.") {
                    type = "warning";
                }
                else if (raw == "'{a}' is defined but never used.") {
                    type = "info";
                }

                errors.push({
                    row: error.line - 1,
                    column: error.character - 1,
                    text: error.reason,
                    type: type,
                    raw: raw
                });

                if (errorAdded) {
                    // break;
                }
            }
            this.sender.emit("annotate", errors);
            return;

        };


    }).call(Worker.prototype);

});

function wordwrap(str, width, brk, cut) {

    brk = brk || '\n';
    width = width || 75;
    cut = cut || false;

    if (!str) {
        return str;
    }

    var regex = '.{1,' + width + '}(\\s|$)' + (cut ? '|.{' + width + '}|.+$' : '|\\S+?(\\s|$)');

    return str.match(RegExp(regex, 'g')).join(brk);

}
