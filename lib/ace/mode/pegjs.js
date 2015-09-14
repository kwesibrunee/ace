define(function(require, exports, module) {
"use strict";

var oop = require("../lib/oop");
// defines the parent mode
var TextMode = require("./text").Mode;
var Tokenizer = require("../tokenizer").Tokenizer;
var MatchingBraceOutdent = require("./matching_brace_outdent").MatchingBraceOutdent;
var WorkerClient = require("../worker/worker_client").WorkerClient;
var Range = require("../range").Range;
// defines the language specific highlighters and folding rules
var PegjsHighlightRules = require("./pegjs_highlight_rules").PegjsHighlightRules;
//var CStyleFoldMode = require("./folding/cstyle").FoldMode;
var TextHighlightRules = require("./text_highlight_rules").TextHighlightRules;
//var CstyleBehaviour = require("./behaviour/cstyle").CstyleBehaviour;
var Mode = function() {
    // set everything up
    this.HighlightRules = TextHighlightRules;
    this.HighlightRules = PegjsHighlightRules;
    this.$outdent = new MatchingBraceOutdent();
    //this.$behaviour = new CstyleBehaviour();
    //this.foldingRules = new CStyleFoldMode();
};
oop.inherits(Mode, TextMode);

(function() {
    // configure comment start/end characters
    this.lineCommentStart = "//";
    this.blockComment = {start: "/*", end: "*/"};

    // special logic for indent/outdent.
    // By default ace keeps indentation of previous line
    this.getNextLineIndent = function(state, line, tab) {
        var indent = this.$getIndent(line);
        return indent;
    };

    this.checkOutdent = function(state, line, input) {
        return this.$outdent.checkOutdent(line, input);
    };

    this.autoOutdent = function(state, doc, row) {
        this.$outdent.autoOutdent(doc, row);
    };
    /**
     * code borrowed from http://davidwalsh.name/add-rules-stylesheets
     */
    function addCSSRule(sheet, selector, rules, index) {
    	if("insertRule" in sheet) {
    		sheet.insertRule(selector + "{" + rules + "}", index);
    	}
    	else if("addRule" in sheet) {
    		sheet.addRule(selector, rules, index);
    	}
    }
    // create worker for live syntax checking
    this.createWorker = function(session) {
        var markers = [];
        // add css rules for language highlighting
        var sheet = document.styleSheets[0];
        addCSSRule(sheet, ".pegjs_highlight_info", "position: absolute;border-bottom: solid 1px gray;z-index: 2000;");
        addCSSRule(sheet, ".pegjs_highlight_error", "position: absolute;border-bottom: solid 1px rgb(224, 4, 4);z-index: 2000;");
        addCSSRule(sheet, ".pegjs_highlight_warning", "position: absolute;border-bottom: solid 1px #DDC50F;z-index: 2000;");
        
        var worker = new WorkerClient(["ace"], "ace/mode/pegjs_worker", "Worker");
        worker.attachToDocument(session.getDocument());
        worker.on("clearMarkers", function (results){
            session.setAnnotations(results.data);
            for (var x=0; x < markers.length;x++){
                session.removeMarker(markers[x]);
            }
            markers = [];
        });
        worker.on("annotate", function(results) {
            session.setAnnotations(results.data);
            for (var x=0, len = results.data.length, error;x<len;x++) {
                error = results.data[x];
                if (error.endColumn) {
                    markers.push(session.addMarker(new Range(error.row, error.column, error.endRow, error.endColumn) , "pegjs_highlight_" + error.type, "text"));
                }
            }
            session._emit("issues", results.data);
        });
        worker.on("terminate", function() {
            session.clearAnnotations();
        });
        worker.on("ast", function (ast) {
           session._emit("ast", ast.data);
        });
        worker.on("rules", function (rules) {
           session._emit("rules", rules.data);
        });
        worker.on("ok", function (parsersource) {
           session._emit("ok", parsersource.data);
        });
        return worker;
    };

}).call(Mode.prototype);

exports.Mode = Mode;
});
