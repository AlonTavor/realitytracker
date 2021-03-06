"use strict";

//Loading order:
//
//0. Before everything:
//0.1 HideInterface() is called to hide all map related interface (playbar, map division, options, left bar)

//1. Icons, Map information JSON, Vehicle informaton JSON:
//1.1 loadIconsAndDictionaries() - Loads all icons and all json.
//1.2 When above done, stage1LoadingFininshed()
//1.2.1 Create a list of vehicle map icons that need to be colored.
//
//2. Demo load deciding phase:
//2.1 if we have a "demo" Query string, Skip to 3
//2.2 Show the demo loading interface and wait for input
//

//3. Demo loading:
//3.1 loadDemo(URL) or loadDemoFromFile() are called depending on input.
//3.1a connectToServer() //TODO
//3.2 When above is done, stage3LoadingFininshed()

//4. Parser goes through the demo and the browser downloads the map image async.
//4.1 when done, stage4LoadingFininshed


//5 Create a copy of the map image and draws the DOD on top 
//	so we have 2 versions one with DoDs and one without (so we dont have to draw the DoD polygons from scratch every draw call.)
//5.1 When above is done ShowInterface() is called and loading is done


// Initial Loading.
$(()=>
{
	hideInterface()
	setLoadingOverlayText("Preparing to load icons...")
	Canvas = $("#map")[0]
	Context = Canvas.getContext("2d")
	mapDiv = $("#mapDiv")[0]
	
	// add onclick listeners to squad tables
	for (var i=1;i<=2;i++)
		for (var j=1;j<=9;j++)
		{
			$("#Squad" + i + j)[0].rows[0].onclick = 
			((ClosureI,ClosureJ) =>
			{
				return (() => {selection_SelectSquad(ClosureI, ClosureJ)})
			})(i,j)
		}
			

	// draw canvas on resize 
	window.onresize = function() {drawCanvas()}
	
	$("#demoFileSelection")[0].addEventListener('change', loadDemoFromFile);
	
	$("#playBar")[0].addEventListener("mouseenter", showPlayBarBubble);
	$("#playBar")[0].addEventListener("mouseleave", hidePlayBarBubble);
	$("#playBar")[0].addEventListener('mousemove',  setPlayBarBubble)
	
	
	loadIconsAndDictionaries()
	
	//$(document).tooltip() TODO
});



var MapsURL = "Maps/" 
var MapImage = null
var MapImageWithCombatArea = null


// Icons and data
var atlas = null
var atlasPNG = null
var atlasJSON_loaded = false
var atlasPNG_loaded = false

//var weaponsData

var vehicleData
var KitNameToImageDictionary

var ThingsLoading = 1
function loadIconsAndDictionaries()
{
	ThingsLoading++
	
	$.getJSON("data.json", json => {
		//VEHICLES
		vehicleData = json.vehicles;
		for (var name in vehicleData)
			{ // Apply default map icon for vehicles without icon.
				if (vehicleData[name].MiniMapIcon == "")
					vehicleData[name].MiniMapIcon = "mini_shp_light"
			}
		
		//ATLAS
		atlas = json.atlas;
		atlasJSON_loaded = true
		atlasLoaded()
		
		
		//KIT DICTIONARY
		KitNameToImageDictionary = json.kits
		objectLoaded();
		})
	
	ThingsLoading++
	atlasPNG = new Image()
	atlasPNG.onload = () =>
	{
		atlasPNG_loaded = true
		atlasLoaded()
		objectLoaded()
	}
	atlasPNG.src = "atlas.png"
	
	objectLoaded() //the entire function is considered "something" loading.
}


// Called when an icon has finished loading 
function objectLoaded()
{
	ThingsLoading--
	setLoadingOverlayText("Loading Icons... " + ThingsLoading + " Left")
	
	if (ThingsLoading == 0)
		stage1LoadingFininshed()
}


var coloredIcons = {}
// TODO might be race condition here? probably done synchronized though because its not actual remote loading
function createColoredMapIcons()
{
	var imagesToColor = new Set()
	for (var vehicle in vehicleData)
		imagesToColor.add(vehicleData[vehicle].MiniMapIcon)
	
	imagesToColor.forEach((name) => {
		var tempImg = new Image()

		// This creates a proper closure. See http://javascriptissexy.com/understand-javascript-closures-with-ease/ Section 3.
		tempImg.onload =
			((closureName, closureImage) =>
			{
				return (() =>
				{
					coloredIcons[closureName] = colorImage(closureImage);
				})
			})(name, tempImg)

		tempImg.onerror = onErrorLoading
		tempImg.src = loadImageFromAtlas(name)
	})
	
}

//Called when all icons are done loading. Now the demo needs to be selected or loaded.
function stage1LoadingFininshed()
{
	createColoredMapIcons()
	
	if (getUrlParameter("demo"))
		loadDemo(getUrlParameter("demo"), false)
	else
	{
		showDemoSelectionInterface()
		setLoadingOverlayText("")
	}
}

//load live Demo from active server
function loadLiveDemo(IP,Port,Username,Password)
{
	if (!WebSocket)
	{
		console.log("Raw TCP sockets are not supported on this browser")
		return false
	}
	
	network_connect(IP,Port,Username,Password,stage3LoadingFininshed, () => {}); //TODO some onerror callback
	//Wait for callback from onConnect and go to stage3 finished
}

//LoadDemo from URL
function loadDemo(link, CredsNeeded)
{
	if (link == "")
		return false
	
	//Manually set query string when loading from a URL
	if (history.pushState) 
	{
		var newurl = window.location.protocol + "//" + window.location.host + window.location.pathname; //get base URL
		newurl += '?demo='+link  //set demo link
		window.history.pushState({path:newurl},'',newurl);
	}
	
	setLoadingOverlayText("Preparing to load demo...")
	var req = new XMLHttpRequest();
	req.open('GET', link);
	
	req.withCredentials = CredsNeeded
	req.responseType = "arraybuffer";
	req.onload = () =>
	{
	
		if (req.status == 401)
		{
			console.log("XMLHttpRequest returned 401, Trying again with 'withCredentials' flag set")
			return loadDemo(link, true)
		
		}
		
		if (req.status != 200 && req.status != 304)
		{
			setLoadingOverlayText("Error downloading demo file. Status code: "+req.status)
			return 
		}
		
		console.log("Request status: "+req.status)
		
		const buffer = req.response;
		
		//Set the global databuffer var (contains the file)
		DataBuffer = checkIfGZAndInflate(buffer);
		
		//Tell the message handler to cut the buffer into an array of dataviews of the buffer
		messageArrayObject.updateNewMessages()
		
		//All Messages parsed, call next stage
		stage3LoadingFininshed()
	}
	req.onprogress = e => 
	{
		const total = e.total ? Math.floor(e.total/1000) : "Unknown "
		setLoadingOverlayText("Loading Demo file... " + Math.floor(e.loaded / 1000) + "kb / " + total +"kb");
	}
	req.onerror= e => 
	{
		setLoadingOverlayText("Error downloading demo file. " + e)
	}
	
	req.send();
	return true
}



//Load demo from selected file
function loadDemoFromFile()
{
	var reader = new FileReader()
	reader.onloadend = () =>
	{
		DataBuffer = checkIfGZAndInflate(reader.result)
		messageArrayObject.updateNewMessages()
		stage3LoadingFininshed()
	}
	reader.readAsArrayBuffer($("#demoFileSelection")[0].files[0])
}



var isParsingDone=false
var isMapDownloadingDone = false

// Temp workaround until v4. I want to get rid of that mapdata.json completely for now.
const mapSizeDict = {
	"operation_falcon": 2,
	"tad_sae": 1,
	"operation_ghost_train": 1,
	"sahel": 2,
	"operation_marlin": 2,
	"burning_sands": 4,
	"pavlovsk_bay": 4,
	"xiangshan": 4,
	"karbala": 2,
	"goose_green": 2,
	"korengal": 1,
	"albasrah_2": 2,
	"operation_soul_rebel": 4,
	"shijiavalley": 4,
	"dragon_fly": 2,
	"gaza_2": 1,
	"hill_488": 1,
	"bijar_canyons": 4,
	"kokan_sp": 2,
	"khamisiyah": 4,
	"kokan": 2,
	"operation_archer": 2,
	"ramiel": 2,
	"qwai1": 2,
	"charlies_point": 2,
	"asad_khal": 1,
	"beirut": 2, 
	"jabal": 2,
	"lashkar_valley": 2,
	"wanda_shan": 4,
	"dovre_winter": 2,
	"yamalia": 4, 
	"dovre": 2,
	"hades_peak": 4,
	"kozelsk": 2,
	"the_falklands": 8,
	"fallujah_west": 1,
	"muttrah_city_2": 2,
	"kashan_desert": 4,
	"battle_of_ia_drang": 2,
	"iron_ridge": 2,
	"bamyan": 4,
	"saaremaa": 4,
	"assault_on_grozny": 2,
	"op_barracuda": 2,
	"fools_road": 2,
	"ulyanovsk": 2,
	"route": 2,
	"test_bootcamp": 1,
	"nuijamaa": 2,
	"sbeneh_outskirts": 2,
	"assault_on_mestia": 1,
	"black_gold": 4,
	"silent_eagle": 4,
	"test_airfield": 4,
	"vadso_city": 4,
	"iron_thunder": 4,
	"shahadah": 2,
	"outpost": 2,
}

//Called when demo buffer is acquired.
function stage3LoadingFininshed()
{
	hideDemoSelectionInterface()
	setLoadingOverlayText("Loading map image... 0%")
	
	
	//Read up to server details message, update things like map name, layer, gamemode, team names.
	if (!isNetworking) //should be already available if we're networking and reached this function
		ReadServerDetails()
	
	if (MapName in mapSizeDict)
		MapSize = mapSizeDict[MapName]
	else
		//TODO ugly prompt for custom maps, remove in V4
		MapSize = prompt("Map unknown, please enter map size (0.5,1,2,4,8)")
	
	//Load this map's image
	MapImage = new Image()
	MapImage.onprogress = updateLoadingStatus
	MapImage.onerror= () => setLoadingOverlayText("Error downloading map image.")
	MapImage.onload= () =>
	{
		isMapDownloadingDone = true
		updateLoadingStatus()
		if (isParsingDone) 
			setTimeout(stage4LoadingFininshed,5)
	}
	MapImage.load(MapsURL + MapName + ".png")
	
	// TODO handle unknown flag names.
	bluforflag = icons[BluForTeam.toLowerCase() + "_cp"]
	opforflag = icons[OpForTeam.toLowerCase() + "_cp"]
	neutralflag = icons["neutral_cp"]
	
	// Parse the file and create checkpoints (while the map downloads!)
	if (!isNetworking)
		ParseDemo_Start()
	else
		ParseDemo_End() //Skip demo parsing for network mode
}



// Parse demo from start to end, count ticks and create checkpoints
// using hacks to make it assync because javascript is shit and there's no other way to force DOM update
function ParseDemo_Start()
{
	isFastForwarding = true
	messagePos = 0
	Tick_Count = 0
	
	ParseDemo_Part()
}
function ParseDemo_Part()
{
	for (var i=0; i<2500; i ++)
		if (!Update()) //if reached end of file, end
		{
			ParseDemo_End()
			return
		}
	
	//after parsing 2500 ticks, sleep a little to let browser redraw UI
	updateLoadingStatus()
	setTimeout(ParseDemo_Part,5)
}
function ParseDemo_End()
{
	isFastForwarding = false;
	isParsingDone = true
	InitialParse = false
	updateLoadingStatus()
	if (isMapDownloadingDone)
		setTimeout(stage4LoadingFininshed,5)
}



var MapImageReady = false

//called when map downloading + demo parsing stage finishes
function stage4LoadingFininshed()
{
	writeServerInfoTable()
	createMapImageWithCombatArea()
	//Remove status overlay
	setLoadingOverlayText("")
	
	//Remove demo selection interface
	hideDemoSelectionInterface() 
	
	//Register keyboard events
	$(document).keydown(onKeyDown)
	$(document).keyup(onKeyUp)
	
	//Show the demo interface
	showInterface()
	
	MapImageReady = true; 
	
	Reset()
	
	//Load options from localStorage
	loadOptions()
	
	//Draw the canvas for the first time
	drawCanvas()
	
	//Reset speed to 1
	setSpeed(1)
	
	onLoad()
}

function writeServerInfoTable()
{
	serverInfoTableAddLine("Server name", ServerName)
	serverInfoTableAddLine("Round start time", new Date(StartTime * 1000).toGMTString())
	serverInfoTableAddLine("Max Players", MaxPlayers)
	serverInfoTableAddLine("Map name", MapName)
	serverInfoTableAddLine("Map mode", GameMode)
	serverInfoTableAddLine("Map layer", Layer)
}

function showDemoSelectionInterface()
{
	$("#DemoSelectionInterface")[0].style.display = "block";
}
function hideDemoSelectionInterface()
{
	$("#DemoSelectionInterface")[0].style.display = "none";
}




function onErrorLoading()
{
	//Planned: deal with 404/503
	console.log("Error loading item")
}

function unload()
{
	//planned. 
}


//misc
function hideInterface()
{
	$.each($(".hideAtStart"), (i,e) => {e.style.display = "none"})
}

function showInterface()
{
	$.each($(".hideAtStart"), (i,e) => {e.style.display = ""})
}


function updateLoadingStatus()
{
	const T1 = MapImage.completedPercentage == 100 ? "Done" : MapImage.completedPercentage + "%"
	const T2 = isParsingDone || isNetworking ? "Done" : Tick_Count
	setLoadingOverlayText("Loading map image and Parsing demo.<br> Map download: " + T1 + "<br>Ticks Parsed: "+T2)
}

function setLoadingOverlayText(Text)
{
	if (Text == "")
	{
		$("#loadingStatusOverlay")[0].style.display = "none"
	}
	else
	{
		$("#loadingStatusOverlay")[0].style.display = "block"
		$("#loadingStatusOverlay")[0].innerHTML = Text
	}
}


function checkIfGZAndInflate(demobuffer)
{
	var dataview = new Uint8Array(demobuffer)
	if(dataview[0] == 0x78 && //This is always true for GZ
	   dataview[1] == 0x9c)  //This marks the selected compression level. It will change if we change compression level. w/e good enough
	{
		console.log("Detected GZ, decompressing")
		return (new Zlib.Inflate(dataview)).decompress().buffer;
	}
	else
	{
		console.log("Not GZ")
		return demobuffer
	}
}


const fillstyle_neutral = "rgba(128, 128, 128, 0.4)";
const fillstyle_red = "rgba(255, 0, 0, 0.2)";
const fillstyle_blue = "rgba(0, 0, 255, 0.2)";
function createMapImageWithCombatArea()
{
	if (MapImageWithCombatArea)
		return
	
	//The scaling functions used here rely on CameraX/Y zeroed
	const CameraXTemp = CameraX
	const CameraYTemp = CameraY
	CameraX = 0
	CameraY = 0
	
	const c = document.createElement('canvas');
	const context = c.getContext("2d")
	c.width = MapImage.width
	c.height = MapImage.height
	context.drawImage(MapImage,0,0)
	
	currentDODList.forEach(function (CA)
	{
		if (CA.inverted == 1) //todo
			return
		
		if (CA.team == 0)
			context.fillStyle = fillstyle_neutral
		else if (CA.team == 2)
			context.fillStyle = fillstyle_red
		else
			context.fillStyle = fillstyle_blue
		
		context.beginPath()
		CA.points.forEach(function (Point)
		{
			const x = XtoCanvas(Point[0]) *2
			const y = YtoCanvas(Point[1]) *2
			context.lineTo(x,y)
		})
		context.closePath()
		
		context.fill()
	})
	
	MapImageWithCombatArea = new Image()
	MapImageWithCombatArea.src = c.toDataURL()
	
	
	CameraX=CameraXTemp
	CameraY=CameraYTemp
}

//Load settings from local storage
function loadOptions()
{
	for (var Name in localStorage) 
		if (Name.startsWith("options_"))
		{
			changeSetting(Name, JSON.parse(localStorage[Name]))
			if($("input[value='"+Name+"']")[0])
				$("input[value='"+Name+"']")[0].checked = window[Name]
		}
}

// Gets an image and returns an array of 4 images where white is replaced by [blue,red,green,white] (No efficient way of real time coloring on canvas?)
function colorImage(white)
{
	var c = document.createElement('canvas');
	var context = c.getContext("2d")
	c.width = white.width
	c.height = white.height
	
	
	context.drawImage(white,0,0)
	var blue = context.getImageData(0, 0, c.width, c.height)
	var red = context.getImageData(0, 0, c.width, c.height)
	var green = context.getImageData(0, 0, c.width, c.height)

	
	for (var i=0;i<blue.data.length;i+=4)
	{
		  // is white enough pixel (Some PR icons are not full white for some reason)
		  if(blue.data[i]>220 &&
			 blue.data[i+1]>220 &&
			 blue.data[i+2]>220
		)
		{
			// change to some colors 
			blue.data[i]=0;
			blue.data[i+1]=64;
			blue.data[i+2]=255;
			
			red.data[i]=255;
			red.data[i+1]=0;
			red.data[i+2]=0;
			
			green.data[i]=0;
			green.data[i+1]=255;
			green.data[i+2]=0;
		}
	}
	
	context.putImageData(blue,0,0)
	blue = new Image()
	blue.src = c.toDataURL()
	
	context.putImageData(red,0,0)
	red = new Image()
	red.src = c.toDataURL()
	
	context.putImageData(green,0,0)
	green = new Image()
	green.src = c.toDataURL()
	
	return [red, blue, green, white];
}