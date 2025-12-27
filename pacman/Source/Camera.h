#ifndef CAMERA_H
#define CAMERA_H

#include <GL/gl.h>
#include <GL/glu.h>
#include "Vector.h"
#include "Constants.h"
#include "Environment.h"
#include <math.h>

#define TPPOV_PRCNT_ZOOM 2.5

class Environment;

class Camera{
private:
	double viewingAngle, viewingDistance, 
		zoomPercent, speed,
		yaw;
	Environment * env;

public:
	Camera(double _viewingAngle,
		double _viewingDistance,
		Environment * _env);
	void setBirdsEyeView();
	void setBirdsEyeFollowView();
	void setFPPOV();
	void setTPPOV();
	void startFilming(int mode);
	void finishFilming(int mode);
	void zoomIn(){ zoomPercent += speed; };
	void zoomOut(){ zoomPercent -= speed; };
	void rotateRight(){ yaw += speed*100; };
	void rotateLeft(){ yaw -= speed*100; };
	void speedUp(){ speed += 0.01; };
	void slowDown(){ 
		speed -= 0.01; 
		if(speed < 0) speed = 0; 
	};


};


#endif
