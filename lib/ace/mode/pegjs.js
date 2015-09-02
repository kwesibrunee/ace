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

    // create worker for live syntax checking
    this.createWorker = function(session) {
        var markers = [];
        var worker = new WorkerClient(["ace"], "ace/mode/pegjs_worker", "Worker");
        worker.attachToDocument(session.getDocument());
        worker.on("parsetree", function (parsetree) {
           session._emit("parsetree", parsetree.data);
        });
        worker.on("parsetreefatal", function (parsetree) {
           session._emit("parsetreefatal", parsetree.data);
        });
        worker.on("annotate", function(results) {
            session.setAnnotations(results.data);
        });
        worker.on("error", function(e) {
            session.setAnnotations([e.data]);
            for (var x=0, len=markers.length;x < len;x++){
                session.removeMarker(markers[x]);
            }
            markers = [];
            if (e.data.endColumn) {
                markers.push(session.addMarker(new Range(e.data.row, e.data.column, e.data.endRow, e.data.endColumn) ,"language_highlight_error", "text"));
            }
        });
        worker.on("multipleErrors", function (e) {
            session.setAnnotations(e.data);
            session._emit("esprimaErrors", e.data);
            for (var x=0, len=markers.length;x < len;x++){
                session.removeMarker(markers[x]);
            }
            markers = [];
            for (var x=0, len = e.data.length, error;x<len;x++) {
                error = e.data[x];
                if (error.endColumn) {
                    markers.push(session.addMarker(new Range(error.row, error.column, error.endRow, error.endColumn) ,"language_highlight_error", "text"));
                }
            }
        });
        worker.on("approximateError", function(e) {
            session.setAnnotations([e.data]);
            for (var x=0, len=markers.length;x < len;x++){
                session.removeMarker(markers[x]);
            }
            markers = [];
            var range = session.getWordRange(e.data.row, e.data.column);
            //debugger;
            markers.push(session.addMarker( range,"language_highlight_error", "text"));
        });
        worker.on("ok", function(e) {
            for (var x=0, len=markers.length;x < len;x++){
                session.removeMarker(markers[x]);
            }
            markers = [];
            session.clearAnnotations();
        });
        worker.on("jslint", function(e) {
            session._emit("jslintErrors", e.data);
            session.setAnnotations(session.getAnnotations().concat(e.data));
            for (var x=0, len = e.data.length, error;x<len;x++) {
                error = e.data[x];
                if (error.endColumn) {
                    markers.push(session.addMarker(new Range(error.row, error.column, error.endRow, error.endColumn) ,"language_highlight_" + error.type, "text"));
                }
            }
        });
        
        worker.on("terminate", function() {
            session.clearAnnotations();
        });
        return worker;
    };

}).call(Mode.prototype);

exports.Mode = Mode;
});
