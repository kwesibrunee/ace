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
        return javascript + "/* Autogenerated file do not modify*/";
    }

    var Worker = exports.Worker = function(sender) {
        Mirror.call(this, sender);
        this.setTimeout(500);
        this.setOptions();
        this.setPegJsBuildOptions();
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
                predef: ["text", "location", "error", "expected", "options"]
            };
            this.doc.getValue() && this.deferredUpdate.schedule(100);
        };
        this.setPegJsBuildOptions = function (src) {
            if (src) {
                try {
                    var temp = src;
                    temp.output = "source";
                    this.pegJsBuildOptions = temp; 
                } catch (e) {
                    this.pegJsBuildOptions = {output:"source"};
                }
            } else {
                this.pegJsBuildOptions = {output:"source"};
            }
            this.doc.getValue() && this.deferredUpdate.schedule(100);
        };
        this.changePegJsBuildOptions = function(src) {
            if (src) {
                try {
                    var newOptions = src;
                    newOptions.output = "source";
                } catch (e) {
                    newOptions = {output:"source"};   
                }
            } else {
                newOptions = {output:"source"};
            }
            oop.mixin(this.pegJsBuildOptions, newOptions);
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
            this.sender.emit("clearMarkers", []);
            var value = this.doc.getValue();
            var ret;
            var errors = [];
            try {
                var timeBefore = (new Date).getTime();
                var temp = peg.buildParser(value, this.pegJsBuildOptions);
                var timeAfter = (new Date).getTime();
                
            }
            catch (e) {
                if (e.location) {
                    errors.push({
                        row: e.location.start.line - 1,
                        column: e.location.start.column-1,
                        endRow: e.location.end.line-1,
                        endColumn: e.location.end.column-1,
                        text:  wordwrap("PEG.js: " + e.message, 75),
                        type: "error",
                        raw: "",
                        linter: "PEG.js"
                    });
                    this.sender.emit("notok", {message:e.message});
                    return this.sender.emit("annotate", errors);
                } 
                this.sender.emit("notok", {message:e.message});
            }
            ret = pegast.parse(value);
            this.sender.emit("ast", ret);
            // Add unused rule and duplicate rule detection
            var rules = {};
            var rulesReferenced = {};
            var first;
            var markContextSeen = function markContextSeen (env, stopAtThisPrototype) {
                var labelsSeen = Object.getOwnPropertyNames(env);
                for (var x=0; x < labelsSeen.length;x++) {
                    env[labelsSeen[x]].seen = true;
                }
                var proto = Object.getPrototypeOf(env);
                if (proto && proto !== parentObj && proto !== stopAtThisPrototype) {
                    markContextSeen(proto, stopAtThisPrototype);
                }
            };
            function getInScopeNames (env, stopAtThisPrototype) {
                var inScope = [];
                inScope = inScope.concat(Object.getOwnPropertyNames(env));
                var proto = Object.getPrototypeOf(env);
                if (proto && proto !== parentObj && proto !== stopAtThisPrototype) {
                    inScope = inScope.concat(getInScopeNames(proto, stopAtThisPrototype));
                }
                return inScope;
            }
            var unusedLabelsCheck = function unusedLabelsCheck(node, checkLocalEnvOnly) {
                if (node.expression && node.expression.context && !node.expression.alternatives) {
                    // unused labels check
                    internalCheck(node.expression.context.env, checkLocalEnvOnly);
                } else if (node.expression && node.expression.context && node.expression.alternatives) {
                    for (var x =0; x < node.expression.alternatives.length;x++) {
                        unusedLabelsCheck(node.expression.alternatives[x], false);
                    }
                }
                
                function internalCheck  (env, checkLocalEnvOnly) {
                    var labelsSeen = Object.getOwnPropertyNames(env);
                    for (var x=0;x < labelsSeen.length;x++) {
                        if (env[labelsSeen[x]].seen !== true) {
                            var node = env[labelsSeen[x]];
                            var labelName = labelsSeen[x].replace(/\$shadowed_/, "");
                            errors.push({
                                row: node.start.line - 1,
                                column: node.start.column - 1,
                                endRow: node.start.line -1,
                                endColumn: (node.start.column - 1) + labelName.length,
                                text: wordwrap("PEG.js: label " + labelName + " cannot be seen by any action or semantic predicate.", 75),
                                type: "info",
                                linter: "PEG.js"
                            });
                        }
                    }
                    if (checkLocalEnvOnly !== true) {
                        var proto = Object.getPrototypeOf(env);
                        if (proto && proto !== Object.prototype) {
                            internalCheck(proto, checkLocalEnvOnly);
                        }        
                    }
                }
            };
            var parentObj = {};
            function internalCheck  (context, stopAtThisPrototype) {
                var env = context.env;
                var labelsSeen = Object.getOwnPropertyNames(env);
                for (var x=0;x < labelsSeen.length;x++) {
                    if (env[labelsSeen[x]].seen !== true) {
                        var node = env[labelsSeen[x]];
                        var labelName = labelsSeen[x].replace(/\$shadowed_/, "");
                        errors.push({
                            row: node.start.line - 1,
                            column: node.start.column - 1,
                            endRow: node.start.line -1,
                            endColumn: (node.start.column - 1) + labelName.length,
                            text: wordwrap("PEG.js: label " + labelName + " cannot be seen by any action or semantic predicate.", 75),
                            type: "info",
                            linter: "PEG.js"
                        });
                    }
                }
                var proto = Object.getPrototypeOf(env);
                if (proto && proto !== parentObj && proto !== stopAtThisPrototype) {
                    internalCheck({env:proto}, stopAtThisPrototype);
                }        
            }
            
            
            var check = visitor.build({
                grammar: function(node) {
                    node.rules.forEach(check);
                },
                rule: function(node) {
                    if (rules[node.name] !== undefined) {
                        errors.push({
                            row: node.location.start.line - 1,
                            column: node.location.start.column - 1,
                            endRow: node.location.start.line -1,
                            endColumn: (node.location.start.column - 1) + node.name.length,
                            text: wordwrap("PEG.js: rule " + node.name + " is already defined on line: " + rules[node.name].location.start.line + " column: " + rules[node.name].location.start.column, 75),
                            type: "warning",
                            linter: "PEG.js"
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
                    // create rule scope
                    var context = {env:Object.create(Object.create(parentObj))};
                    check(node.expression, context);
                    internalCheck(context);
                },
                named: function(node, context) {
                    check(node.expression, context);
                },

                choice: function(node, context) {
                    // reference old scope
                    var oldScope = context.env;
                    for (var x=0; x < node.alternatives.length; x++) {
                         // create a scope
                        context.env = Object.create(context.env);
                        check(node.alternatives[x], context);
                        internalCheck(context, oldScope);
                        // restore old scope
                        context.env = oldScope;
                    }
                },
                action: function(node, context) {
                    var originalScope = context.env;
                    // create a scope
                    context.env = Object.create(context.env);
                    // process
                    check(node.expression, context);
                    // get inScopeLabels
                    var temp = getInScopeNames(context.env, originalScope);
                    node.$labelsInScope = temp;
                    // markLabels in current context seen
                    markContextSeen(context.env, originalScope);
                },
                sequence: function(node, context) {
                    // create a scope
                    context.env = Object.create(context.env);
                    for (var x =0; x < node.elements.length;x++) {
                        check(node.elements[x], context);
                    }
                },
                labeled: function(node, context) {
                    
                    // reference old scope
                    var parentScope = context.env;
                    // create a scope
                    //context.env = Object.create(context.env);
                    // mark duplicate labels
                    if (parentScope.hasOwnProperty(node.label)) {
                        errors.push({
                            row: node.location.start.line - 1,
                            column: node.location.start.column - 1,
                            endRow: node.location.start.line -1,
                            endColumn: (node.location.start.column - 1) + node.label.length,
                            text: wordwrap("PEG.js: label " + node.label + " is already defined in this scope on line: " + parentScope[node.label].start.line + " column: " + parentScope[node.label].start.column, 75),
                            type: "warning",
                            linter: "PEG.js"
                        });
                    } else {
                        parentScope[node.label] = node.location;
                    }
                    // process
                    check(node.expression, context);
                },
                text: function(node, context) {
                    // create a scope
                    context.env = Object.create(context.env);
                    // process
                    check(node.expression, context);
                },
                simple_not: function(node, context) {
                    // create a scope
                    context.env = Object.create(context.env);
                    // process
                    check(node.expression, context);
                },
                simple_and: function(node, context) {
                    // create a scope
                    context.env = Object.create(context.env);
                    // process
                    check(node.expression, context);
                },
                optional: function(node, context) {
                    // create a scope
                    context.env = Object.create(context.env);
                    // process
                    check(node.expression, context);
                },
                zero_or_more: function(node, context) {
                    // create a scope
                    context.env = Object.create(context.env);
                    // process
                    check(node.expression, context);
                },
                one_or_more: function(node, context) {
                    // create a scope
                    context.env = Object.create(context.env);
                    // process
                    check(node.expression, context);
                },
                semantic_not: function(node, context) {
                    var temp = [];
                    for (var prop in context.env) {
                        temp.push(prop);
                    }
                    node.$labelsInScope = temp;
                    markContextSeen(context.env);
                },
                semantic_and: function(node, context) {
                    var temp = [];
                    for (var prop in context.env) {
                        temp.push(prop);
                    }
                    node.$labelsInScope = temp;
                    markContextSeen(context.env);
                },
                rule_ref: function(node, context) {
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
                literal: function(node, context) {
                },
                "class": function(node, context) {
                    
                },
                any: function(node, context) {
                    
                },
            });
            check(ret);
            for (var ruleName in rules) {
                if (ruleName !== first && !rulesReferenced[ruleName]) {
                    errors.push({
                        row: rules[ruleName].location.start.line - 1,
                        column: rules[ruleName].location.start.column - 1,
                        endRow: rules[ruleName].location.start.line -1,
                        endColumn: (rules[ruleName].location.start.column - 1) + rules[ruleName].name.length,
                        text: wordwrap("PEG.js: rule " + rules[ruleName].name + " is defined but never referenced", 75),
                        type: "info",
                        linter: "PEG.js"
                    });
                }
            }
            this.sender.emit("rules",  rules);
            // JSHINT
            try {
                value = eachCode(ret, value);
            } catch (e) {
                
            }
            //value = value.replace(/^#!.*\n/, "\n");
            if (!value)
                return this.sender.emit("annotate", []);
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
                var endColumny;
                if (raw == "'{a}' is already defined." || raw == "'{a}' is defined but never used.") {
                    endColumny = error.character-1;
                    error.character = error.character - error.a.length;
                } else if (raw === "['{a}'] is better written in dot notation.") {
                    endColumny = (error.character-1) + error.a.length + 4;
                } else {
                    endColumny = (error.a) ? (error.character-1) + error.a.length: error.character-1;
                }
                errors.push({
                    row: error.line - 1,
                    column: error.character - 1,
                    endRow: error.line -1,
                    endColumn: endColumny,
                    text: wordwrap("JSHint: " + error.reason, 75),
                    type: type,
                    raw: raw,
                    linter: "JSHint"
                });

                if (errorAdded) {
                    // break;
                }
                if (i > 100) {
                    errors.push({
                        row: error.line - 1,
                        column: error.character - 1,
                        endRow: error.line -1,
                        endColumn: endColumny,
                        text: wordwrap("JSHint: Too many errors ", 75),
                        type: type,
                        raw: raw,
                        linter: "JSHint"
                    });
                    break;
                }
            }
            if (!errorAdded) {
                this.sender.emit("ok", {source:temp, buildtime:timeAfter-timeBefore});
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

function shallowClone (obj) {
    var descriptor = {}, ownPropertyNames = Object.getOwnPropertyNames(obj);
    for (var x =0; x < ownPropertyNames.length;x++) {
        descriptor[ownPropertyNames[x]] = Object.getOwnPropertyDescriptor(obj, ownPropertyNames[x]);
    }
    return Object.create(Object.getPrototypeOf(obj), descriptor);
}
