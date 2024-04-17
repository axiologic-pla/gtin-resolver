# How to use PharmaLedger ePI XSD

Link to the XSD: [PharmaLedger ePI XSD](./pharmaleger-leaflet-v1.xsd)

## Sections

Due to the design how the ePI leaflet is shown on the app, only section headers and their content are considered for
display
e.g.

```   
<section level="1">
	<header>
		<b>1. What xxx is and what it is used for</b>
	</header>
	<p>xxx contains three active substances....</p> 
</section>
```

All other information can be part of the XML e.g. product name, Ingredient Substance
but those information are not part of the display on the app.

## Hide Elements

If your XML contains information which shouldn’t be displayed on the leaflet, please add one or multiple of those class
attributes:

- `class="Type"`
- `class="Product_Name"`
- `class="Ingredient Substance"`
- `class="Read Instructions"`
- `class="Table of Content"`
- `class="ignore_from_ui"`

e.g.

```   
<p class="Product_Name">  
	<b>Test_Material</b>  
</p> 
```

or

```
<p class="ignore_from_ui">  
	<b>09506000140445</b>  
</p> 
```

## Search Support

If you like to enable the users to search on the text of your pictures, please include the text as part of the `figure`
tag:

e.g.

```
<figure>
	<img src="figure_008_0933_2573_6566_2740.png" />
	<p>Trockenmittel</p>
</figure>
```

## General

Any other xml tags (not part of the XSD) will be treated as HTML and shown in the ePI leaflet.
