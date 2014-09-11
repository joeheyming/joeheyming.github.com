function Actor(imgUrl, fileInfo, props) {
    I = {};
    I.props = {
        x: 0,
        y: 0,
        scaleX: 0,
        scaleY: 0,
        rotation: 0,
        alpha: 1,
        frameIndex: 0
    };
    merge(I.props, props);

    I.sprite = Sprite(imgUrl, fileInfo);

    I.draw = function () {
        this.sprite.draw(canvas, this.props.frameIndex, this.props.x, this.props.y, this.props.scaleX, this.props.scaleY, this.props.rotation, this.props.alpha);
    };

	I.queuedKeyFrames = [];
    I.durationSeconds = undefined;
    I.intoAnimationSeconds = undefined;
    I.beginProps = undefined;
    I.endProps = undefined;

    I.update = function (deltaSeconds) {
		if (this.queuedKeyFrames.length > 0) {
			if (undefined == this.durationSeconds) {
				var keyFrame = this.queuedKeyFrames.shift();
				this.durationSeconds = keyFrame.durationSeconds;
				this.intoAnimationSeconds = 0;
				this.beginProps = deepCopy(this.props);
				this.endProps = deepCopy(keyFrame.props);
			}
		}
        if (undefined != this.durationSeconds) {
            this.intoAnimationSeconds += deltaSeconds;
            var percentThrough = this.intoAnimationSeconds / this.durationSeconds;
            if (percentThrough >= 1) {
                merge(this.props, this.endProps);				
                this._endKeyframe();
            } else {
                for (var attr in this.endProps) {
                    this.props[attr] = this.beginProps[attr] + (this.endProps[attr] - this.beginProps[attr]) * percentThrough;
                }
            }
        }
    };

    I.set = function (props) {
        merge(this.props, props);
        return this;
    }
    I.animate = function (props, sec) {
		var keyFrame = {
			props: deepCopy(props),
			durationSeconds: sec,
		}
		this.queuedKeyFrames.push(keyFrame);
        return this;
    };

    I.stop = function () {
        this._endKeyframe();
        this.queuedKeyFrames = [];
        return this;
    };
    I.finish = function () {
        this._endKeyframe();
        this.queuedKeyFrames = [];
        return this;
    };
    I._endKeyframe = function () {
        this.durationSeconds = undefined;
        this.intoAnimationSeconds = undefined;
        this.beginProps = undefined;
        this.endProps = undefined;
    };

    return I;
}
