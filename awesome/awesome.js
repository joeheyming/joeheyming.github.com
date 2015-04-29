var awesomeNamespace = (function() {
    var namespace = {};
    var awesome_mp3 = '/awesome/awesome.mp3';
    var awesome_nyan_gif = 'http://mlpforums.com/uploads/post_images/img-2896624-1-Nyan_Cat_Emoticon.gif';
    function awesomeColor() {
        var color = "#";
        for (var k = 0; k < 3; k++) {
            color += ("0" + (Math.random()*256|0).toString(16)).substr(-2);
        }
        return color;
    };
    function awesomeEventCode(e) {
        e = e || window.event;
        return (e.keyCode || e.which);
    };

    var awesome_lyrics = [
        {lyric: 'Everything is Awesome!', wait: 4000},
        {lyric: 'Everything is cool when you\'re part of a Team!', wait: 4000},
        {lyric: 'Everything is Awesome', wait: 4000},
        {lyric: 'When you\'re living our dream', wait: 4000}
    ];
    
    namespace.Awesome = function() {
        this.render();
        this.awesomeReset();
        this.installAwesomeEvents();
        this.awesomeCallback = this.checkAwesomeLyric.bind(this);
        this.awesomeCheckInterval = setInterval(this.awesomeCheck.bind(this), 1000);
    };
    namespace.Awesome.prototype = {
        awesomeColorInterval: null,
        //awesomeLyricInterval: null,
        awesome_counter: 0,
        awesome_block: 0,
        awesome_time_counter: 0,
        render: function() {
            this.awesome_container = document.createElement('div');
            this.awesome_container.id = 'awesome_parent';
            this.awesome_content = document.createElement('div');
            this.awesome_content.id = 'awesome_div';
            this.awesome_container.appendChild(this.awesome_content);
            document.body.appendChild(this.awesome_container);

            this.awesome_audio = document.createElement('audio');
            this.awesome_audio.controls = true;
            this.awesome_audio.loop = true;
            document.body.appendChild(this.awesome_audio);
            this.awesome_audio.src = awesome_mp3;
        },
        clearAwesomeContent: function() {
            while (this.awesome_content.firstChild) {
                this.awesome_content.removeChild(this.awesome_content.firstChild);
            }
        },
        awesomeCheck: function() {
            if (!this.awesome_audio.paused) {
                this.setAwesomeColor();
                this.awesomeCallback();
            }
        },
        getAwesomeLyric: function() {
            return awesome_lyrics[this.awesome_counter % awesome_lyrics.length ];
        },
        checkAwesomeLyric: function() {
            var awesome_obj = this.getAwesomeLyric();
            this.awesome_time_counter += 1000;
            if (this.awesome_time_counter > this.awesome_block) {
                this.awesome_counter++;
                var awesome_obj = this.getAwesomeLyric();
                this.awesome_block = this.awesome_block + awesome_obj.wait;
            }
            this.clearAwesomeContent();
            this.awesome_content.textContent = awesome_obj.lyric;
        },
        setAwesomeColor: function() {
            window.awesome_div.style.color = awesomeColor();       
            window.awesome_parent.style.background = awesomeColor();       
        },
        awesomeReset: function() {
            this.awesome_counter = 0;
            this.awesome_block = awesome_lyrics[this.awesome_counter % awesome_lyrics.length ].wait
            this.awesome_time_counter = 0;
            this.awesomePlay();
        },
        awesomePlay: function() {
            this.awesome_audio.play();
        },
        awesomePause: function() {
            this.awesome_audio.pause();
        },
        awesomeToggle: function() {
            if (this.awesome_audio.paused) {
                this.awesomePlay();
            } else {
                this.awesomePause();
            }
        },
        awesomeCheckNyan: function() {
            if (window.awesome_nyan) {
                return;
            }
            
            var awesome_nyan = new Image();
            awesome_nyan.id = 'awesome_nyan';
            awesome_nyan.src = awesome_nyan_gif;
            this.awesome_content.textContent = '';
            this.awesome_content.appendChild(awesome_nyan);
        },
        installAwesomeEvents: function() {
            document.onkeydown = function(e) {
                var key = awesomeEventCode(e);
                if (key == '32' || key == '13') { // enter or spacebar
                    this.awesomeToggle();
                }
                if (key == '27') { // esc key
                    this.awesomePause();
                    this.awesomeReset();
                    this.awesome_audio.currentTime = 0;
                }
                if (key == '65') { // a
                    this.awesomeCallback = this.checkAwesomeLyric.bind(this);
                }
                if (key == '78') { // n
                    this.awesomeCallback = this.awesomeCheckNyan.bind(this);
                }
            }.bind(this);
            document.onmouseover = function(e) {
                document.body.focus();
            }.bind(this);
            document.onclick = function(e) {
                if (e.button == 0) {
                    this.awesomeToggle();
                }
            }.bind(this)
        }
    };
    return namespace;
})();
