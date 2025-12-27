#include "Camera.h"

Camera::Camera(double _viewingAngle,
		double _viewingDistance,
		Environment * _env){
	viewingAngle = _viewingAngle;
	viewingDistance = _viewingDistance;
	zoomPercent = 1.0;
	yaw = 0;
	speed = 0.01;
	env = _env;

}

void Camera::setBirdsEyeView(){
	glTranslatef(-env->getWidth()*env->getScale()/2,
		     	 -env->getLength()*env->getScale()/2, 
				 0);
}

void Camera::setBirdsEyeFollowView(){
	Vector point = env->getPlayer()->getCoords();
	glTranslatef(-point.x,-point.y,-point.z);
}

void Camera::setFPPOV(){
	Vector point = env->getPlayer()->getCoords();
	Vector facing = env->getPlayer()->getFacing();
	/*glTranslatef(0,
		-viewingDistance*zoomPercent/TPPOV_PRCNT_ZOOM,
		-2*(-viewingDistance*zoomPercent/TPPOV_PRCNT_ZOOM)*
		tan(PI*viewingAngle/180));*/
	glRotatef(-env->getPlayer()->getPitch(),
			  1.0,0.0,0.0);
	glRotatef(-env->getPlayer()->getYaw(),0.0,0.0,1.0);
	
	glTranslatef(-point.x,-point.y,-point.z);

}

void Camera::setTPPOV(){
	Vector point = env->getPlayer()->getCoords();
	
	glTranslatef(0,
		-viewingDistance*zoomPercent/TPPOV_PRCNT_ZOOM,
		-2*(-viewingDistance*zoomPercent/TPPOV_PRCNT_ZOOM)*
		tan(PI*viewingAngle/180));

	glRotatef(-env->getPlayer()->getYaw(),0.0,0.0,1.0);
	glTranslatef(-point.x,-point.y,-point.z);
	
}

void Camera::startFilming(int mode){
	//set camera style

	//make the objects farther away initially
	//glRotatef(yaw,0.0,0.0,1.0);
	

	switch(mode){
	case BIRDSEYE:	
		glTranslatef(0,0,
			-viewingDistance*zoomPercent);
		glRotatef(-viewingAngle, 1.0, 0.0, 0.0);
		setBirdsEyeView();
		break;
	case BIRDSEYE_FOLLOW:
		glTranslatef(0,0,
			-viewingDistance*zoomPercent);
		glRotatef(-viewingAngle, 1.0, 0.0, 0.0);
		setBirdsEyeFollowView();
		break;
	case FPPOV:
		glRotatef(-90, 1.0, 0.0, 0.0);
		//glTranslatef(0,0,0);
		

		setFPPOV();
		break;
	case TPPOV:
		glTranslatef(0,0,
			-viewingDistance*zoomPercent);
		glRotatef(-viewingAngle, 1.0, 0.0, 0.0);
		setTPPOV();
		break;
	}
}
